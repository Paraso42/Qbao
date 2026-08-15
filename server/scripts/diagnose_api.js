// 端到端 AI 出题 API 诊断 — 测试完整 /api/v1/ai/generate 端点
// 用法: node diagnose_api.js <api_key> [model]

const API_KEY = process.argv[2] || '';
const MODEL = process.argv[3] || 'ecnu-plus';
const BASE_URL = 'http://localhost:3001';  // test backend

if (!API_KEY || API_KEY.length < 10) {
  console.error('用法: node diagnose_api.js <ecnu_api_key> [模型id]');
  process.exit(1);
}

// 模拟 JWT token
const TEST_TOKEN = process.argv[4] || '';

async function testApiGenerate(stream, strictFormat, label) {
  console.log('\n--- ' + label + ' ---');

  try {
    const headers = {
      'Content-Type': 'application/json',
      'x-ai-api-key': API_KEY,
      'x-ai-model': MODEL,
      'x-ai-provider': 'ecnu',
      'x-ai-stream': stream ? 'true' : 'false',
      'x-ai-strict-format': strictFormat ? 'true' : 'false'
    };
    if (TEST_TOKEN) {
      headers['Authorization'] = 'Bearer ' + TEST_TOKEN;
    }

    const body = {
      textContent: '请出3道关于计算机网络的单选题。要求覆盖TCP/UDP、HTTP、DNS。',
      typeCounts: { single: 3, judge: 0, term: 0, short: 0 },
      prompt: '你是一个出题助手。请根据提供的资料生成题目。重要：只输出纯JSON数组，不要包含任何其他文字。'
    };

    const start = Date.now();
    const res = await fetch(BASE_URL + '/api/v1/ai/generate', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    });

    const elapsed = Date.now() - start;

    if (!res.ok) {
      const err = await res.text();
      console.log('  ❌ HTTP', res.status, '(' + elapsed + 'ms)');
      console.log('  错误:', err.substring(0, 300));
      return { status: 'ERROR', code: res.status, error: err.substring(0, 200) };
    }

    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) {
      // ===== SSE 流式响应 =====
      console.log('  📡 SSE 流式响应 (' + elapsed + 'ms)');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalContent = '';
      let parsedCount = 0;
      let doneQuestions = null;
      let doneError = null;
      let eventCount = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          try {
            const evt = JSON.parse(data);
            eventCount++;
            if (evt.content) totalContent += evt.content;
            if (evt.newParsed && evt.newParsed.length > 0) {
              parsedCount += evt.newParsed.length;
              console.log('  📦 增量解析:', evt.newParsed.length, '题 (累计', parsedCount + ')');
            }
            if (evt.done) {
              if (evt.error) {
                doneError = evt.error;
                console.log('  ⚠️ done.error:', evt.error);
              }
              if (evt.questions) {
                doneQuestions = evt.questions;
                console.log('  ✅ done.questions:', evt.questions.length, '题');
              }
            }
          } catch (e) { /* skip */ }
        }
      }

      console.log('  SSE事件数:', eventCount, '| 总内容长度:', totalContent.length, '| 增量题数:', parsedCount);

      const finalQuestions = doneQuestions || [];
      if (finalQuestions.length > 0) {
        console.log('  🎉 最终成功:', finalQuestions.length, '题');
        return { status: 'OK', questions: finalQuestions.length, events: eventCount };
      } else {
        console.log('  ❌ 0 题! doneError:', doneError);
        return { status: 'ZERO', error: doneError, events: eventCount };
      }
    } else {
      // ===== 非流式 JSON 响应 =====
      const data = await res.json();
      console.log('  📄 JSON 响应 (' + elapsed + 'ms)');
      const qCount = data.questions ? (Array.isArray(data.questions) ? data.questions.length : 1) : 0;
      console.log('  题目数:', qCount);
      if (data.poolFilesStatus) {
        console.log('  文件状态:', data.poolFilesStatus.length, '个');
      }
      if (qCount > 0 && data.questions[0]) {
        console.log('  示例:', JSON.stringify(data.questions[0]).substring(0, 150));
      }
      return { status: qCount > 0 ? 'OK' : 'ZERO', questions: qCount };
    }
  } catch (e) {
    console.log('  ❌ 异常:', e.message);
    return { status: 'ERROR', error: e.message };
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('端到端 AI API 诊断 — ' + MODEL + ' @ ' + BASE_URL);
  console.log('='.repeat(70));

  // Check if server is up
  try {
    const health = await fetch(BASE_URL + '/api/v1/ai/providers');
    if (health.ok) {
      const pdata = await health.json();
      console.log('✅ 后端在线, 提供者:', pdata.providers.map(p => p.id).join(', '));
    } else {
      console.log('⚠️ 后端 /api/v1/ai/providers 返回', health.status);
    }
  } catch (e) {
    console.log('❌ 后端不可达:', e.message);
    process.exit(1);
  }

  // Test 1: Non-streaming + strict (v3.11.12 working path)
  await testApiGenerate(false, true, 'Test 1: 非流式 + strict=true (v3.11.12 对照组)');

  // Test 2: Streaming + no strict (v3.12.0 path)
  await testApiGenerate(true, false, 'Test 2: 流式 + strict=false (v3.12.0 路径)');

  // Test 3: Streaming + strict
  await testApiGenerate(true, true, 'Test 3: 流式 + strict=true');

  // Test 4: Non-streaming + no strict
  await testApiGenerate(false, false, 'Test 4: 非流式 + strict=false');

  console.log('\n' + '='.repeat(70));
  console.log('完成');
}

main().catch(e => { console.error(e); process.exit(1); });
