<!-- 登录/注册/离线模式弹窗（自 legacy auth-dialog + users.js doLogin/doRegister 迁移） -->
<template>
  <Modal :open="ui.authOpen" @close="ui.closeAuth">
    <h3 class="ad-title">登录 / 注册</h3>
    <div class="tabs ad-tabs">
      <div class="tab" :class="{ active: tab === 'login' }" @click="tab = 'login'">登录</div>
      <div class="tab" :class="{ active: tab === 'register' }" @click="tab = 'register'">注册</div>
      <div class="tab" :class="{ active: tab === 'offline' }" @click="tab = 'offline'">离线模式</div>
    </div>

    <form v-if="tab === 'login'" class="ad-form" @submit.prevent="doLogin">
      <label class="ad-label">用户名</label>
      <input v-model="loginForm.username" class="input" type="text" placeholder="输入用户名" autocomplete="username">
      <label class="ad-label">密码</label>
      <input v-model="loginForm.password" class="input" type="password" placeholder="输入密码" autocomplete="current-password">
      <p v-if="error" class="ad-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary btn-small" @click="ui.closeAuth">取消</button>
        <button type="submit" class="btn btn-primary btn-small" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
      </div>
    </form>

    <form v-else-if="tab === 'register'" class="ad-form" @submit.prevent="doRegister">
      <label class="ad-label">用户名</label>
      <input v-model="regForm.username" class="input" type="text" placeholder="至少3个字符" autocomplete="username">
      <label class="ad-label">显示名称</label>
      <input v-model="regForm.displayName" class="input" type="text" placeholder="可选">
      <label class="ad-label">密码</label>
      <input v-model="regForm.password" class="input" type="password" placeholder="至少6个字符" autocomplete="new-password">
      <label class="ad-label">确认密码</label>
      <input v-model="regForm.password2" class="input" type="password" placeholder="再次输入密码" autocomplete="new-password">
      <p v-if="error" class="ad-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary btn-small" @click="ui.closeAuth">取消</button>
        <button type="submit" class="btn btn-success btn-small" :disabled="busy">{{ busy ? '注册中…' : '注册' }}</button>
      </div>
    </form>

    <div v-else class="ad-form">
      <p class="ad-offline-tip">离线模式下，数据仅保存在本地浏览器，不会同步到云端。</p>
      <div class="dialog-actions">
        <button class="btn btn-primary btn-small" @click="enterOffline">进入离线模式</button>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { useUiStore } from '../../../stores/ui'
import { useUserStore } from '../../../stores/user'
import Modal from '../../ui/Modal.vue'

const ui = useUiStore()
const user = useUserStore()

const tab = ref('login')
const error = ref('')
const busy = ref(false)
const loginForm = reactive({ username: '', password: '' })
const regForm = reactive({ username: '', displayName: '', password: '', password2: '' })

watch(() => ui.authOpen, (open) => {
  if (open) { error.value = ''; busy.value = false }
})

async function doLogin() {
  error.value = ''
  if (!loginForm.username.trim() || !loginForm.password) { error.value = '请输入用户名和密码'; return }
  busy.value = true
  try {
    await user.login(loginForm.username.trim(), loginForm.password)
    ui.closeAuth()
  } catch (e) {
    error.value = e.message || '登录失败'
  } finally {
    busy.value = false
  }
}

async function doRegister() {
  error.value = ''
  if (!regForm.username.trim()) { error.value = '请输入用户名'; return }
  if (regForm.username.trim().length < 3) { error.value = '用户名至少 3 个字符'; return }
  if (regForm.password.length < 6) { error.value = '密码至少 6 位'; return }
  if (regForm.password !== regForm.password2) { error.value = '两次输入的密码不一致'; return }
  busy.value = true
  try {
    await user.register(regForm.username.trim(), regForm.displayName.trim(), regForm.password)
    ui.closeAuth()
  } catch (e) {
    error.value = e.message || '注册失败'
  } finally {
    busy.value = false
  }
}

function enterOffline() {
  user.enterOfflineMode()
  ui.closeAuth()
  ui.toast('已进入离线模式', 'info')
}
</script>

<style scoped>
.ad-title { margin-bottom: var(--space-md); }
.ad-tabs { margin-bottom: var(--space-lg); }
.ad-form { display: flex; flex-direction: column; gap: var(--space-sm); }
.ad-label { font-size: var(--fs-sm); color: var(--text-secondary); }
.ad-error { color: var(--color-danger); font-size: var(--fs-sm); }
.ad-offline-tip { color: var(--text-secondary); font-size: var(--fs-base); }
</style>
