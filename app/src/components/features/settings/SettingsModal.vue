<!-- 设置弹窗：个性化 + AI 配置 + 桌面端（自 legacy settings.js 迁移，DeepSeek 风格重设计） -->
<template>
  <Modal :open="ui.settingsOpen" wide full @close="ui.closeSettings">
    <div class="sm-body">
      <nav class="sm-nav">
        <div class="sm-nav-title">设置</div>
        <div class="sm-nav-item" :class="{ active: activeTab === 'personalize' }" @click="ui.setSettingsTab('personalize')"><Icon name="settings" :size="15" />个性化</div>
        <div class="sm-nav-item" :class="{ active: activeTab === 'aiconfig' }" @click="ui.setSettingsTab('aiconfig')"><Icon name="sparkle" :size="15" />AI 配置</div>
        <div v-if="isDesktop" class="sm-nav-item" :class="{ active: activeTab === 'desktop' }" @click="ui.setSettingsTab('desktop')"><Icon name="download" :size="15" />桌面端</div>
      </nav>

      <div class="sm-content">
        <!-- 个性化 -->
        <section v-if="activeTab === 'personalize'" class="sm-tab">
          <div class="card">
            <div class="settings-section">
              <h4>边栏</h4>
              <div class="settings-row">
                <label>边栏字体大小</label>
                <input type="range" min="11" max="16" step="1" :value="settings.sidebarFontSize" @input="onFont('sidebarFontSize', $event)" @change="data.saveState()">
                <span class="settings-val">{{ settings.sidebarFontSize }}px</span>
              </div>
              <div class="font-preview" :style="{ fontSize: settings.sidebarFontSize + 'px' }"><strong>科目名称</strong><span>章节 1.1 — 3 题</span></div>
            </div>
            <div class="settings-section">
              <h4>顶栏</h4>
              <div class="settings-row">
                <label>顶栏字体大小</label>
                <input type="range" min="11" max="18" step="1" :value="settings.topbarFontSize" @input="onFont('topbarFontSize', $event)" @change="data.saveState()">
                <span class="settings-val">{{ settings.topbarFontSize }}px</span>
              </div>
            </div>
            <div class="settings-section">
              <h4>主页区域</h4>
              <div class="settings-row">
                <label>主页字体大小</label>
                <input type="range" min="15" max="22" step="1" :value="settings.mainFontSize" @input="onFont('mainFontSize', $event)" @change="data.saveState()">
                <span class="settings-val">{{ settings.mainFontSize }}px</span>
              </div>
            </div>
            <div class="settings-section">
              <h4>答题区域</h4>
              <div class="settings-row">
                <label>题目字体大小</label>
                <input type="range" min="14" max="28" step="1" :value="settings.quizFontSize" @input="onFont('quizFontSize', $event)" @change="data.saveState()">
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
            <div class="settings-section">
              <div class="settings-row">
                <label>恢复默认</label>
                <button class="btn btn-secondary btn-small" @click="resetDefaults">恢复默认设置</button>
              </div>
            </div>
          </div>
        </section>

        <!-- AI 配置（P2.2 拆分：AiConfigSection） -->
        <AiConfigSection v-else-if="activeTab === 'aiconfig'" ref="aiCfgRef" />

        <!-- 桌面端 -->
        <section v-else-if="activeTab === 'desktop'" class="sm-tab">
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
import { IS_DESKTOP, desktopBridge } from '../../../core/env'
import { applyFontSizes } from '../../../core/fontSizes'
import Modal from '../../ui/Modal.vue'
import Icon from '../../ui/Icon.vue'
import Toggle from '../../ui/Toggle.vue'
import AiConfigSection from './AiConfigSection.vue'

const ui = useUiStore()
const data = useDataStore()
const aiCfgRef = ref(null)

const settings = computed(() => data.state.settings)
// 打开即渲染：任何未知 tab 都回退到「个性化」，保证设置弹窗永不空白
const activeTab = computed(() => (['personalize', 'aiconfig', 'desktop'].includes(ui.settingsTab) ? ui.settingsTab : 'personalize'))

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
  applyFontSizes(settings.value)
}
function saveSettings() {
  data.saveState()
  applyFontSizes(settings.value)
}
async function resetDefaults() {
  const ok = await ui.openConfirm('恢复默认设置', '字体大小、外观与提醒将恢复为默认值，AI 配置不受影响。确定继续？', '恢复')
  if (!ok) return
  data.state.settings = { quizFontSize: 17, sidebarFontSize: 13, topbarFontSize: 14, mainFontSize: 17, darkMode: false, showNoticeBar: true }
  saveSettings()
  ui.toast('已恢复默认设置', 'ok')
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
    updateMessage.value = '当前环境不支持自动更新'
    return
  }
  updateChecking.value = true
  updateState.value = 'info'
  updateMessage.value = '正在检查更新…'
  d.checkForUpdates().then((r) => {
    updateChecking.value = false
    if (!r) return
    if (r.error) { updateState.value = 'err'; updateMessage.value = r.error; return }
    if (!r.hasUpdate) { updateState.value = 'ok'; updateMessage.value = '已是最新版本' }
  }).catch((e) => {
    updateChecking.value = false
    updateState.value = 'err'
    updateMessage.value = (e && e.message) || '检查失败'
  })
}
// P0.5: 服务器地址改为应用内输入框（ui.openPrompt）+ toast 反馈，替代原生 prompt/alert
function showServerSetup() {
  const d = desktopBridge()
  if (!d || typeof d.setServer !== 'function') { ui.toast('当前环境不支持修改服务器地址', 'err'); return }
  ui.openPrompt('设置服务器地址（如 https://your-server.example）', 'https://').then((url) => {
    if (url == null) return
    const trimmed = String(url).trim()
    if (!/^https?:\/\//.test(trimmed)) { ui.toast('请输入完整地址，如 https://your-server.example', 'err'); return }
    d.setServer(trimmed, '服务器')
      .then((r) => {
        if (r && r.ok !== false) {
          desktopInfo.value.apiBase = trimmed
          ui.toast('服务器地址已保存，重启应用生效', 'ok')
        } else {
          ui.toast('保存失败: ' + ((r && r.error) || '未知错误'), 'err')
        }
      })
      .catch((e) => ui.toast('保存失败: ' + ((e && e.message) || '未知错误'), 'err'))
  })
}
function bindUpdateStatus() {
  const d = desktopBridge()
  if (!d || typeof d.onUpdateStatus !== 'function') return
  d.onUpdateStatus((s) => {
    if (!s) return
    if (s.state === 'progress') { updateState.value = 'info'; updateMessage.value = '正在下载更新 ' + (s.percent || 0) + '%' }
    else if (s.state === 'downloaded') { updateState.value = 'ok'; updateMessage.value = '更新已下载完成，重启应用即可安装' }
    else if (s.state === 'error') { updateState.value = 'err'; updateMessage.value = (s.message || '检查失败') }
  })
}

watch(() => ui.settingsOpen, (open) => {
  if (open) {
    if (activeTab.value === 'aiconfig') {
      if (aiCfgRef.value) aiCfgRef.value.loadForm()
    }
    if (activeTab.value === 'desktop') loadDesktopInfo()
  }
})
watch(() => ui.settingsTab, (tab) => {
  if (!ui.settingsOpen) return
  if (tab === 'aiconfig') { if (aiCfgRef.value) aiCfgRef.value.loadForm() }
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
.sm-nav-item.active { background: var(--sidebar-active); color: var(--color-primary); font-weight: 500; box-shadow: inset 2px 0 0 var(--color-primary); }
.sm-content { flex: 1; min-width: 0; padding: var(--space-2xl); overflow-y: auto; max-height: 70vh; }
.settings-row { display: flex; align-items: center; gap: var(--space-md); padding: var(--space-md) 0; border-bottom: 1px solid var(--border-light); }
.settings-row label:not(.toggle-switch) { min-width: 110px; font-size: var(--fs-base); color: var(--text-primary); flex-shrink: 0; }
.settings-row .toggle-switch { min-width: var(--track-width); max-width: var(--track-width); }
.settings-row input[type="range"] {
  flex: 1;
  max-width: 220px;
  -webkit-appearance: none;
  appearance: none;
  height: 22px;
  background: transparent;
  cursor: pointer;
  margin: 0;
}
/* WebKit：runnable-track 默认按拇指宽度内缩，使滑条长度=拇指实际行程 */
.settings-row input[type="range"]::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: var(--border-default);
}
.settings-row input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--color-primary);
  border: none;
  box-shadow: var(--shadow-sm);
}
.settings-row input[type="range"]:hover::-webkit-slider-thumb { background: var(--color-primary-hover); }
.settings-row input[type="range"]::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--border-default);
}
.settings-row input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--color-primary);
  border: none;
}
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