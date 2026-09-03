<template>
  <section class="sm-tab">
    <div class="card">
      <div class="settings-section">
        <h4>AI API 配置</h4>
        <p class="ai-desc">选择 AI 提供商并配置对应 API 密钥，可在章节界面使用 AI 自动生成题目。密钥仅保存在本机，不随数据同步。</p>
        <p v-if="IS_DESKTOP" class="ai-help-note">桌面端：密钥由系统安全存储（Windows DPAPI / safeStorage）加密落盘，应用内不保留明文。</p>
        <p v-else class="ai-help-note">网页端：密钥仅以混淆形式保存在本地浏览器，无法达到系统级加密强度，请勿在公共设备保存密钥。</p>

        <div class="settings-row">
          <label>提供商</label>
          <select v-model="providerId" class="select" @change="onProviderChange">
            <option v-for="p in ai.providers" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>

        <div v-if="currentProvider" class="ai-provider-meta">
          <div class="ai-meta-row">
            <span class="ai-meta-label">API 地址</span>
            <code class="ai-meta-url">{{ currentProvider.baseUrl }}</code>
          </div>
          <div class="cap-chips">
            <span v-if="currentProvider.capabilities && currentProvider.capabilities.streaming" class="cap-chip">流式</span>
            <span v-if="currentProvider.capabilities && currentProvider.capabilities.jsonSchema" class="cap-chip">JSON Schema</span>
            <span v-if="currentProvider.capabilities" class="cap-chip">{{ formatContext(currentProvider.capabilities.maxContext) }} 上下文</span>
            <span v-if="currentProvider.capabilities && currentProvider.capabilities.vision" class="cap-chip">视觉</span>
            <span v-if="currentProvider.supportsCustomBaseUrl" class="cap-chip">自定义地址（暂未开放）</span>
          </div>
        </div>

        <div class="settings-row">
          <label>模型</label>
          <select v-model="modelId" class="select">
            <option v-for="m in currentModels" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>

        <div class="settings-row">
          <label>API 密钥</label>
          <div class="key-row">
            <input v-model="apiKeyInput" class="input key-input" :type="keyVisible ? 'text' : 'password'" :placeholder="keyPlaceholder">
            <button type="button" class="btn btn-ghost btn-small" @click="keyVisible = !keyVisible" :title="keyVisible ? '隐藏' : '显示'"><Icon name="eye" :size="14" /></button>
            <button type="button" class="btn btn-ghost btn-small" @click="clearKey" title="清除已保存密钥"><Icon name="trash" :size="14" /></button>
          </div>
        </div>

        <div class="settings-row">
          <label>AI 自动判定</label>
          <span class="row-desc">生成后自动判定客观题（选择/判断）正误；主观题仍需你自行审核<em>（消耗一次额外调用）</em></span>
          <Toggle v-model="selfCheck" />
        </div>
        <div class="settings-row">
          <label>服务端任务队列</label>
          <span class="row-desc">后台出题<em> · 关闭设置窗口后，AI 仍会继续生成题目</em></span>
          <Toggle v-model="useServerQueue" />
        </div>

        <div class="settings-col">
          <label class="col-label">环境提示词</label>
          <p class="col-hint">这段提示词将作为所有 AI 对话的基础上下文，用于稳定规范大模型行为。<span>{{ systemPrompt.length }} 字</span></p>
          <textarea v-model="systemPrompt" class="textarea" rows="4" maxlength="2000" placeholder="例如：你是一名专业的教育学教授助手，擅长根据教材内容生成高质量题目。"></textarea>
        </div>

        <div class="ai-actions">
          <button class="btn btn-primary btn-small" @click="saveConfig"><Icon name="check" :size="14" />保存配置</button>
          <button class="btn btn-secondary btn-small" :disabled="testing" @click="testConfig"><Icon name="search" :size="14" />{{ testing ? '测试中…' : '测试连接' }}</button>
        </div>
        <div class="ai-status" :class="'ai-status-' + statusType">
          <span v-if="statusMsg">{{ statusMsg }}</span>
        </div>
      </div>

      <div class="settings-section">
        <h4>使用说明</h4>
        <div class="ai-help">
          <p>1. 选择 AI 提供商（ECNU / DeepSeek / OpenAI / Gemini）</p>
          <p>2. 在对应平台获取 API 密钥并粘贴保存</p>
          <p>3. 选择合适的模型</p>
          <p>4. 在章节页面点击「AI 生成」即可上传资料并自动生成题目</p>
          <p class="ai-help-note">密钥仅保存在本机{{ IS_DESKTOP ? '（系统加密存储）' : '（浏览器混淆存储）' }}，AI 请求经后端代理转发，密钥不上传服务器。</p>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
// P2.2：AI 配置区块（自 SettingsModal.vue 拆出）— 状态走 store，交互留在区块内
import { computed, onMounted, ref } from 'vue'
import { useAiStore } from '../../../stores/ai'
import { useDataStore } from '../../../stores/data'
import { useUiStore } from '../../../stores/ui'
import { IS_DESKTOP } from '../../../core/env'
import { getAiApiKey } from '../../../services/aiKeys'
import Icon from '../../ui/Icon.vue'
import Toggle from '../../ui/Toggle.vue'

const ai = useAiStore()
const data = useDataStore()
const ui = useUiStore()

const providerId = ref('ecnu')
const modelId = ref('')
const apiKeyInput = ref('')
const keyVisible = ref(false)
const selfCheck = ref(false)
const useServerQueue = ref(false)
const systemPrompt = ref('')
const statusMsg = ref('')
const statusType = ref('')
const testing = ref(false)

const currentProvider = computed(() => ai.getProvider(providerId.value))
const currentModels = computed(() => (currentProvider.value && currentProvider.value.models) || [])
const keyPlaceholder = computed(() => {
  const saved = getAiApiKey(providerId.value)
  return saved ? '已保存 (长度 ' + saved.length + ' 字符)' : '粘贴 ' + (currentProvider.value ? currentProvider.value.name : '') + ' API Key'
})

// 打开设置/切换 tab 时由父组件调用（先保证 provider 目录就绪再回填表单）
function loadForm() {
  return ai.ensureProviders().then(() => {
    const ac = data.state.aiConfig || {}
    providerId.value = ac.provider || 'ecnu'
    const remembered = (data.state.aiConfig.modelByProvider || {})[providerId.value]
    modelId.value = remembered || ac.model || ai.defaultModelFor(providerId.value)
    apiKeyInput.value = ''
    keyVisible.value = false
    selfCheck.value = ac.selfCheck === true
    useServerQueue.value = ac.useServerQueue === true
    systemPrompt.value = ac.systemPrompt || ''
    statusMsg.value = ''
  })
}

function onProviderChange() {
  modelId.value = ai.defaultModelFor(providerId.value)
  apiKeyInput.value = ''
}

// v3.33.1 修复：Modal 关闭即销毁内容（v-if），重开/切 tab 时父组件 watch 在
// pre-flush 阶段触发、aiCfgRef 尚为 null，loadForm 被跳过 → 模型选择一栏空白。
// 改为挂载即回填（幂等，与父组件 watch 兼容）。
onMounted(() => { loadForm() })

async function saveConfig() {
  ai.saveAiConfig({
    provider: providerId.value,
    model: modelId.value,
    apiKey: apiKeyInput.value,
    systemPrompt: systemPrompt.value,
    selfCheck: selfCheck.value,
    useServerQueue: useServerQueue.value
  })
  apiKeyInput.value = ''
  statusMsg.value = '配置已保存'
  statusType.value = 'ok'
}

async function testConfig() {
  statusMsg.value = '正在通过后端测试连接…'
  statusType.value = 'info'
  testing.value = true
  try {
    ai.saveAiConfig({
      provider: providerId.value,
      model: modelId.value,
      apiKey: apiKeyInput.value,
      systemPrompt: systemPrompt.value,
      selfCheck: selfCheck.value,
      useServerQueue: useServerQueue.value
    })
    apiKeyInput.value = ''
    const r = await ai.testConnection()
    statusMsg.value = '连接成功 (' + r.provider + '/' + r.model + ')，耗时 ' + (r.latencyMs || '?') + 'ms'
    statusType.value = 'ok'
  } catch (e) {
    statusMsg.value = (e.message || '测试失败')
    statusType.value = 'err'
  } finally {
    testing.value = false
  }
}

async function clearKey() {
  const ok = await ui.openConfirm('清除 API 密钥', '清除后将无法使用 AI 出题功能，需要重新配置密钥。确定清除？', '清除', { danger: true })
  if (!ok) return
  ai.clearApiKey(providerId.value)
  ui.toast('已清除 ' + providerId.value + ' 的密钥', 'info')
}

function formatContext(n) {
  if (!n) return ''
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(0) + 'M'
  if (n >= 1024) return Math.round(n / 1024) + 'K'
  return String(n)
}

defineExpose({ loadForm })
</script>

<style scoped>
.settings-row { display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md) 0; border-bottom: 1px solid var(--border-light); }
.settings-row label:not(.toggle-switch) { min-width: 110px; font-size: var(--fs-base); color: var(--text-primary); flex-shrink: 0; }
.settings-row .toggle-switch { min-width: var(--track-width); max-width: var(--track-width); }
.row-desc { flex: 1; font-size: var(--fs-sm); color: var(--text-secondary); }
.row-desc em { color: var(--text-muted); font-style: normal; font-size: var(--fs-xs); }
.ai-desc { color: var(--text-secondary); font-size: var(--fs-sm); margin-bottom: var(--space-sm); }
.ai-provider-meta { margin: var(--space-sm) 0; }
.ai-meta-row { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-sm); }
.ai-meta-label { font-size: var(--fs-xs); color: var(--text-muted); min-width: 56px; }
.ai-meta-url { font-size: var(--fs-xs); color: var(--text-secondary); background: var(--surface-hover); padding: 2px 8px; border-radius: var(--radius-sm); word-break: break-all; }
.cap-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.key-row { display: flex; gap: 6px; flex: 1; }
.key-input { flex: 1; }
.settings-col { padding: var(--space-md) 0; border-bottom: 1px solid var(--border-light); }
.col-label { font-size: var(--fs-base); display: block; margin-bottom: 4px; }
.col-hint { color: var(--text-muted); font-size: var(--fs-xs); margin-bottom: 8px; }
.ai-actions { display: flex; gap: var(--space-sm); margin-top: var(--space-lg); }
.ai-status { margin-top: var(--space-sm); font-size: var(--fs-sm); color: var(--text-muted); }
.ai-status-ok { color: var(--color-success); }
.ai-status-err { color: var(--color-danger); }
.ai-status-info { color: var(--color-primary); }
.ai-help { font-size: var(--fs-sm); color: var(--text-secondary); line-height: 1.9; }
.ai-help-note { margin-top: 8px; color: var(--text-muted); font-size: var(--fs-xs); }
</style>
