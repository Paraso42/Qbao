<!-- 登录/注册弹窗（离线模式作为底部链接，不混淆认证语义） -->
<template>
  <Modal :open="ui.authOpen" @close="ui.closeAuth">
    <h3 class="ad-title">登录 / 注册</h3>
    <div class="tabs ad-tabs">
      <div class="tab" :class="{ active: tab === 'login' }" @click="tab = 'login'">登录</div>
      <div class="tab" :class="{ active: tab === 'register' }" @click="tab = 'register'">注册</div>
    </div>

    <form v-if="tab === 'login'" class="ad-form" @submit.prevent="doLogin">
      <label class="ad-label">用户名</label>
      <input v-model="loginForm.username" class="input" type="text" placeholder="输入用户名" autocomplete="username">
      <label class="ad-label">密码</label>
      <div class="ad-pass">
        <input v-model="loginForm.password" class="input" :type="pwVisible ? 'text' : 'password'" placeholder="输入密码" autocomplete="current-password">
        <button type="button" class="ad-pass-btn" :title="pwVisible ? '隐藏密码' : '显示密码'" @click="pwVisible = !pwVisible"><Icon name="eye" :size="15" /></button>
      </div>
      <div class="ad-misc">
        <button type="button" class="ad-link" @click="forgotPassword">忘记密码？</button>
      </div>
      <p v-if="error" class="ad-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary btn-small" @click="ui.closeAuth">取消</button>
        <button type="submit" class="btn btn-primary btn-small" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
      </div>
    </form>

    <form v-else class="ad-form" @submit.prevent="doRegister">
      <label class="ad-label">用户名</label>
      <input v-model="regForm.username" class="input" type="text" placeholder="至少 3 个字符" autocomplete="username">
      <label class="ad-label">显示名称</label>
      <input v-model="regForm.displayName" class="input" type="text" placeholder="可选">
      <label class="ad-label">密码</label>
      <input v-model="regForm.password" class="input" type="password" placeholder="至少 6 个字符" autocomplete="new-password">
      <label class="ad-label">确认密码</label>
      <input v-model="regForm.password2" class="input" type="password" placeholder="再次输入密码" autocomplete="new-password">
      <p v-if="error" class="ad-error">{{ error }}</p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary btn-small" @click="ui.closeAuth">取消</button>
        <button type="submit" class="btn btn-primary btn-small" :disabled="busy">{{ busy ? '注册中…' : '注册' }}</button>
      </div>
    </form>

    <div class="ad-offline">
      <button class="ad-link" @click="enterOffline">继续以离线模式使用 →</button>
    </div>
  </Modal>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { useUiStore } from '../../../stores/ui'
import { useUserStore } from '../../../stores/user'
import Modal from '../../ui/Modal.vue'
import Icon from '../../ui/Icon.vue'

const ui = useUiStore()
const user = useUserStore()

const tab = ref('login')
const error = ref('')
const busy = ref(false)
const pwVisible = ref(false)
const loginForm = reactive({ username: '', password: '' })
const regForm = reactive({ username: '', displayName: '', password: '', password2: '' })

watch(() => ui.authOpen, (open) => {
  if (open) { error.value = ''; busy.value = false; pwVisible.value = false }
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
  ui.toast('已进入离线模式，数据仅保存在本机', 'info')
}

function forgotPassword() {
  ui.toast('请联系管理员重置密码（邮箱找回即将上线）', 'info', 5000)
}
</script>

<style scoped>
.ad-title { margin-bottom: var(--space-md); }
.ad-tabs { margin-bottom: var(--space-lg); }
.ad-form { display: flex; flex-direction: column; gap: var(--space-sm); }
.ad-label { font-size: var(--fs-sm); color: var(--text-secondary); }
.ad-pass { position: relative; }
.ad-pass .input { padding-right: 40px; }
.ad-pass-btn {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
}
.ad-pass-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.ad-misc { display: flex; justify-content: flex-end; }
.ad-link { color: var(--color-primary); font-size: var(--fs-sm); }
.ad-link:hover { text-decoration: underline; }
.ad-error { color: var(--color-danger); font-size: var(--fs-sm); }
.ad-offline {
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border-light);
  display: flex;
  justify-content: center;
}
</style>
