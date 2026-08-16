<!-- 设置弹窗：个性化 + AI 配置 + 桌面端（自 legacy settings.js 迁移，DeepSeek 风格重设计） -->
<template>
  <Modal :open="ui.settingsOpen" wide full @close="ui.closeSettings">
    <div class="sm-body">
      <nav class="sm-nav">
        <div class="sm-nav-title">设置</div>
        <div class="sm-nav-item" :class="{ active: ui.settingsTab === 'personalize' }" @click="ui.setSettingsTab('personalize')"><Icon name="settings" :size="15" />个性化</div>
        <div class="sm-nav-item" :class="{ active: ui.settingsTab === 'aiconfig' }" @click="ui.setSettingsTab('aiconfig')"><Icon name="sparkle" :size="15" />AI 配置</div>
        <div v-if="isDesktop" class="sm-nav-item" :class="{ active: ui.settingsTab === 'desktop' }" @click="ui.setSettingsTab('desktop')"><Icon name="download" :size="15" />桌面端</div>
      </nav>

      <div class="sm-content">
        <!-- 个性化 -->
        <section v-if="ui.settingsTab === 'personalize'" class="sm-tab">
          <div class="card">
            <div class="settings-section">
              <h4>边栏</h4>
              <div class="settings-row">
                <label>边栏字体大小</label>
                <input type="range" min="11" max="16" step="1" :value="settings.sidebarFontSize" @input="onFont('sidebarFontSize', $event)">
                <span class="settings-val">{{ settings.sidebarFontSize }}px</span>
              </div>
              <div class="font-preview" :style="{ fontSize: settings.sidebarFontSize + 'px' }"><strong>科目名称</strong><span>章节 1.1 — 3 题</span></div>
            </div>
            <div class="settings-section">
              <h4>顶栏</h4>
              <div class="settings-row">
                <label>顶栏字体大小</label>
                <input type="range" min="11" max="18" step="1" :value="settings.topbarFontSize" @input="onFont('topbarFontSize', $event)">
                <span class="settings-val">{{ settings.topbarFontSize }}px</span>
              </div>
            </div>
            <div class="settings-section">
              <h4>主页区域</h4>
              <div class="settings-row">
                <label>主页字体大小</label>
                <input type="range" min="15" max="22" step="1" :value="settings.mainFontSize" @input="onFont('mainFontSize', $event)">
                <span class="settings-val">{{ settings.mainFontSize }}px</span>
              </div>
            </div>
            <div class="settings-section">
              <h4>答题区域</h4>
              <div class="settings-row">
                <label>题目字体大小</label>
                <input type="range" min="14" max="28" step="1" :value="settings.quizFontSize" @input="onFont('quizFontSize', $event)">
                <span class="settings-val">{{ settings.quizFontSize }}px</span>
              </div>
            </div>
            <div class="settings-section">
              <h4>外观</h4>
              <div class="settings-row">
                <label>夜间模式</label>
                <Toggle v-model="darkMode" @change="saveSettings" />
              </div>
              <div class="settings-row">
                <label>消息提醒</label>
                <Toggle v-model="showNoticeBar" @change="saveSettings" />
              </div>
            </div>
          </div>
        </section>

        <!-- AI 配置 -->
        <section v-else-if="ui.settingsTab === 'aiconfig'" class="sm-tab">
          <div class="card">
            <div class="settings-section">
              <h4>AI API 配置</h4>
              <p class="ai-desc">选择 AI 提供商并配置对应 API 密钥，可在章节界面使用 AI 自动生成题目。密钥仅保存在本机，不随数据同步。</p>

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
                <span class="row-desc">生成后让 AI 二次审核并修正题目<em>（消耗一次额外调用）</em></span>
                <Toggle v-model="selfCheck" />
              </div>
              <div class="settings-row">
                <label>服务端任务队列</label>
                <span class="row-desc">后台生成<em>（非流式，关闭页面后任务仍继续）</em></span>
                <Toggle v-model="useServerQueue" />
              </div>

              <div class="settings-col">
                <label class="col-label">环境提示词</label>
                <p class="col-hint">这段提示词将作为所有 AI 对话的基础上下文，用于稳定规范大模型行为。<span>{{ systemPrompt.length }} 字</span></p>
                <textarea v-model="systemPrompt" class="textarea" rows="4" maxlength="2000" placeholder="例如：你是一名专业的教育学教授助手，擅长根据教材内容生成高质量题目。"></textarea>
              </div>

              <div class="ai-actions">
                <button class="btn btn-primary btn-small" @click="saveConfig"><Icon name="check" :size="14" />保存配置</button>
                <button class="btn btn-secondary btn-small" :disabled="testing" @click="testConfig">{{ testing ? '测试中…' : '🔍 测试连接' }}</button>
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
                <p class="ai-help-note">密钥仅保存在本地浏览器，通过后端代理调用 AI 接口。</p>
              </div>
            </div>
          </div>
        </section>

        <!-- 桌面端 -->
        <section v-else-if="ui.settingsTab === 'desktop'" class="sm-tab">
          <div class="card">
            <div class="settings-section">
              <h4>应用信息</h4>
              <div class="settings-row"><label>当前版本</label><span class="row-val">v{{ desktopInfo.version || '?' }}</span></div>
              <div class="settings-row"><label>服务器地址</label><span class="row-val break">{{ desktopInfo.apiBase || '未配置' }}</span></div>
              <div class="settings-row">
                <label>开机自启</label>
                <span class="row-desc">登录系统时启动 Qbao</span>
                <Toggle :model-value="desktopInfo.autoStart" @change="toggleAutoStart" />
              </div>
              <div class="settings-row">
                <label>服务器设置</label>
                <button class="btn btn-secondary btn-small" @click="showServerSetup">修改服务器地址</button>
              </div>
            </div>
            <div class="settings-section">
              <h4>软件更新</h4>
              <div class="ai-status" :class="'ai-status-' + updateState">{{ updateMessage }}</div>
              <div class="ai-actions">
                <button class="btn btn-primary btn-small" :disabled="updateChecking" @click="checkUpdates">检查更新</button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useUiStore } from '../../../stores/ui'
import { useDataStore } from '../../../stores/data'
import { useAiStore } from '../../../stores/ai'
import { IS_DESKTOP, desktopBridge } from '../../../core/env'
import { getAiApiKey } from '../../../services/aiKeys'
import { showServerSetupDialog } from '../../../services/api'
import { applyFontSizes } from '../../../core/fontSizes'
import Modal from '../../ui/Modal.vue'
import Icon from '../../ui/Icon.vue'
import Toggle from '../../ui/Toggle.vue'

const ui = useUiStore()
const data = useDataStore()
const ai = useAiStore()

const settings = computed(() => data.state.settings)

// 个性化
const darkMode = computed({
  get: () => settings.value.darkMode,
  set: (v) => { settings.value.darkMode = v }
})
const showNoticeBar = computed({
  get: () => settings.value.showNoticeBar !== false,
  set: (v) => { settings.value.showNoticeBar = v }
})
function onFont(key, e) {
  settings.value[key] = parseInt(e.target.value) || 17
  saveSettings()
}
function saveSettings() {
  data.saveState()
  applyFontSizes(settings.value)
}

// AI 配置
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

function loadAiForm() {
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
}

function onProviderChange() {
  modelId.value = ai.defaultModelFor(providerId.value)
  apiKeyInput.value = ''
}

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
  statusMsg.value = '✅ 配置已保存'
  statusType.value = 'ok'
}

async function testConfig() {
  statusMsg.value = '⏳ 通过后端测试连接...'
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
    statusMsg.value = '✅ 连接成功 (' + r.provider + '/' + r.model + ')，耗时 ' + (r.latencyMs || '?') + 'ms'
    statusType.value = 'ok'
  } catch (e) {
    statusMsg.value = '❌ ' + (e.message || '测试失败')
    statusType.value = 'err'
  } finally {
    testing.value = false
  }
}

function clearKey() {
  ai.clearApiKey(providerId.value)
  ui.toast('已清除 ' + providerId.value + ' 的密钥', 'info')
}

function formatContext(n) {
  if (!n) return ''
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(0) + 'M'
  if (n >= 1024) return Math.round(n / 1024) + 'K'
  return String(n)
}

// 桌面端
const isDesktop = ref(IS_DESKTOP)
const desktopInfo = ref({ version: '', apiBase: '', serverLabel: '', autoStart: false })
const updateState = ref('idle')
const updateMessage = ref('启动应用后会自动检查更新；有新版本时会提示下载。')
const updateChecking = ref(false)

function loadDesktopInfo() {
  const d = desktopBridge()
  if (!d || typeof d.getAppInfo !== 'function') return
  d.getAppInfo().then((info) => { desktopInfo.value = Object.assign({}, info || {}) }).catch(() => {})
}
function toggleAutoStart(v) {
  const d = desktopBridge()
  if (!d || typeof d.setAutoStart !== 'function') return
  d.setAutoStart(!!v).then((r) => {
    if (r && r.ok !== false) { desktopInfo.value.autoStart = !!r.autoStart; ui.toast(r.autoStart ? '已开启开机自启' : '已关闭开机自启', 'ok') }
    else ui.toast('设置失败: ' + ((r && r.error) || '未知错误'), 'err')
  }).catch(() => {})
}
function checkUpdates() {
  const d = desktopBridge()
  if (!d || typeof d.checkForUpdates !== 'function') {
    updateState.value = 'err'
    updateMessage.value = '❌ 当前环境不支持自动更新'
    return
  }
  updateChecking.value = true
  updateState.value = 'info'
  updateMessage.value = '⏳ 正在检查更新...'
  d.checkForUpdates().then((r) => {
    updateChecking.value = false
    if (!r) return
    if (r.error) { updateState.value = 'err'; updateMessage.value = '❌ ' + r.error; return }
    if (!r.hasUpdate) { updateState.value = 'ok'; updateMessage.value = '✅ 已是最新版本' }
  }).catch((e) => {
    updateChecking.value = false
    updateState.value = 'err'
    updateMessage.value = '❌ ' + ((e && e.message) || '检查失败')
  })
}
function showServerSetup() { showServerSetupDialog() }
function bindUpdateStatus() {
  const d = desktopBridge()
  if (!d || typeof d.onUpdateStatus !== 'function') return
  d.onUpdateStatus((s) => {
    if (!s) return
    if (s.state === 'progress') { updateState.value = 'info'; updateMessage.value = '⬇️ 正在下载更新 ' + (s.percent || 0) + '%' }
    else if (s.state === 'downloaded') { updateState.value = 'ok'; updateMessage.value = '✅ 更新已下载完成，重启应用即可安装' }
    else if (s.state === 'error') { updateState.value = 'err'; updateMessage.value = '❌ ' + (s.message || '检查失败') }
  })
}

watch(() => ui.settingsOpen, (open) => {
  if (open) {
    if (ui.settingsTab === 'aiconfig') {
      ai.ensureProviders().then(loadAiForm)
    } else {
      loadAiForm()
    }
    if (ui.settingsTab === 'desktop') loadDesktopInfo()
  }
})
watch(() => ui.settingsTab, (tab) => {
  if (!ui.settingsOpen) return
  if (tab === 'aiconfig') ai.ensureProviders().then(loadAiForm)
  if (tab === 'desktop') loadDesktopInfo()
})

onMounted(() => { bindUpdateStatus(); applyFontSizes(settings.value) })
</script>

<style scoped>
.sm-body { display: flex; gap: 0; margin: calc(var(--space-2xl) * -1); min-height: 420px; }
.sm-nav {
  width: 180px;
  flex-shrink: 0;
  background: var(--surface-hover);
  border-right: 1px solid var(--border-light);
  border-radius: var(--radius-lg) 0 0 var(--radius-lg);
  padding: var(--space-lg) var(--space-sm);
}
.sm-nav-title { font-size: var(--fs-sm); color: var(--text-muted); padding: 0 var(--space-md) var(--space-sm); }
.sm-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: var(--radius-md);
  font-size: var(--fs-base);
  color: var(--text-secondary);
  cursor: pointer;
  margin-bottom: 2px;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.sm-nav-item:hover { background: var(--surface-card); color: var(--text-primary); }
.sm-nav-item.active { background: var(--color-primary-light); color: var(--color-primary); font-weight: 500; }
.sm-content { flex: 1; min-width: 0; padding: var(--space-2xl); overflow-y: auto; max-height: 70vh; }
.settings-row { display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md) 0; border-bottom: 1px solid var(--border-light); }
.settings-row label { min-width: 110px; font-size: var(--fs-base); color: var(--text-primary); flex-shrink: 0; }
.settings-row input[type="range"] { flex: 1; max-width: 220px; accent-color: var(--color-primary); }
.settings-val { font-size: var(--fs-base); font-weight: 600; min-width: 44px; color: var(--color-primary); text-align: right; }
.row-desc { flex: 1; font-size: var(--fs-sm); color: var(--text-secondary); }
.row-desc em { color: var(--text-muted); font-style: normal; font-size: var(--fs-xs); }
.row-val { color: var(--text-secondary); font-size: var(--fs-base); }
.row-val.break { word-break: break-all; }
.font-preview { display: flex; align-items: baseline; gap: 10px; margin-top: 6px; padding: 6px 12px; background: var(--surface-hover); border-radius: var(--radius-md); border-left: 3px solid var(--color-primary); color: var(--text-secondary); }
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
@media (max-width: 768px) {
  .sm-body { flex-direction: column; margin: calc(var(--space-lg) * -1); }
  .sm-nav { width: 100%; display: flex; align-items: center; gap: 4px; border-right: none; border-bottom: 1px solid var(--border-light); border-radius: var(--radius-lg) var(--radius-lg) 0 0; padding: var(--space-sm); overflow-x: auto; }
  .sm-nav-title { display: none; }
  .sm-nav-item { white-space: nowrap; flex-shrink: 0; margin-bottom: 0; }
  .sm-content { max-height: none; padding: var(--space-lg); }
  .settings-row { flex-wrap: wrap; }
  .settings-row label { min-width: 100%; }
}
</style>
