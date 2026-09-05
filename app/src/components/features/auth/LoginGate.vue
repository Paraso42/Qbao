<!--
  LoginGate.vue — 登录门禁（v3.36.1）
  未登录即整页门禁：不渲染任何业务功能；数据不落盘（拒绝匿名存储）。
  唯一例外：设置入口（桌面端首次运行需先配置服务器地址）。
-->
<template>
  <div class="lg-wrap">
    <div class="lg-card">
      <div class="lg-mark">Q</div>
      <h1 class="lg-title">Qbao</h1>
      <p class="lg-sub">按章节刷题 · AI 智能出题 · 大考卷</p>

      <div class="tabs lg-tabs">
        <div class="tab" :class="{ active: tab === 'login' }" @click="tab = 'login'">登录</div>
        <div class="tab" :class="{ active: tab === 'register' }" @click="tab = 'register'">注册</div>
      </div>

      <form v-if="tab === 'login'" class="lg-form" @submit.prevent="doLogin">
        <label class="lg-label">用户名</label>
        <input v-model="loginForm.username" class="input" type="text" placeholder="输入用户名" autocomplete="username">
        <label class="lg-label">密码</label>
        <div class="lg-pass">
          <input v-model="loginForm.password" class="input" :type="pwVisible ? 'text' : 'password'" placeholder="输入密码" autocomplete="current-password">
          <button type="button" class="lg-pass-btn" :title="pwVisible ? '隐藏密码' : '显示密码'" @click="pwVisible = !pwVisible"><Icon name="eye" :size="15" /></button>
        </div>
        <p v-if="error" class="lg-error">{{ error }}</p>
        <button type="submit" class="btn btn-primary lg-submit" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
      </form>

      <form v-else class="lg-form" @submit.prevent="doRegister">
        <label class="lg-label">用户名</label>
        <input v-model="regForm.username" class="input" type="text" placeholder="至少 3 个字符" autocomplete="username">
        <label class="lg-label">显示名称</label>
        <input v-model="regForm.displayName" class="input" type="text" placeholder="可选" autocomplete="nickname">
        <label class="lg-label">密码</label>
        <input v-model="regForm.password" class="input" type="password" placeholder="至少 6 个字符" autocomplete="new-password">
        <label class="lg-label">确认密码</label>
        <input v-model="regForm.password2" class="input" type="password" placeholder="再次输入密码" autocomplete="new-password">
        <p v-if="error" class="lg-error">{{ error }}</p>
        <button type="submit" class="btn btn-primary lg-submit" :disabled="busy">{{ busy ? '注册中…' : '注册' }}</button>
      </form>

      <p class="lg-note">登录后数据按账号独立存储并云端同步；未登录不保存任何数据。</p>
      <div class="lg-foot">
        <button class="btn btn-ghost btn-small" @click="ui.openSettings()"><Icon name="settings" :size="13" /> 设置</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useUserStore } from '../../../stores/user'
import { useUiStore } from '../../../stores/ui'
import Icon from '../../ui/Icon.vue'

const user = useUserStore()
const ui = useUiStore()
const tab = ref('login')
const error = ref('')
const busy = ref(false)
const pwVisible = ref(false)
const loginForm = reactive({ username: '', password: '' })
const regForm = reactive({ username: '', displayName: '', password: '', password2: '' })

async function doLogin() {
  error.value = ''
  if (!loginForm.username.trim() || !loginForm.password) { error.value = '请输入用户名和密码'; return }
  busy.value = true
  try {
    await user.login(loginForm.username.trim(), loginForm.password)
    // 登录成功：applyAuth 触发整页重建（首次登录/切换账号）
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
  } catch (e) {
    error.value = e.message || '注册失败'
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.lg-wrap {
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-xl);
  background: var(--surface-bg);
}
.lg-card {
  width: 100%;
  max-width: 380px;
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
  padding: var(--space-3xl);
}
.lg-mark {
  width: 52px; height: 52px;
  margin: 0 auto var(--space-md);
  display: flex; align-items: center; justify-content: center;
  font-size: 26px; font-weight: 700; color: #fff;
  border-radius: var(--radius-xl);
  background: var(--gradient-primary);
  box-shadow: var(--shadow-sm);
}
.lg-title { text-align: center; font-size: var(--fs-2xl); margin-bottom: var(--space-xs); }
.lg-sub { text-align: center; color: var(--text-muted); font-size: var(--fs-sm); margin-bottom: var(--space-xl); }
.lg-tabs { margin-bottom: var(--space-lg); }
.lg-form { display: flex; flex-direction: column; gap: var(--space-sm); }
.lg-label { font-size: var(--fs-sm); color: var(--text-secondary); }
.lg-pass { position: relative; }
.lg-pass .input { padding-right: 40px; }
.lg-pass-btn {
  position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm); color: var(--text-muted);
}
.lg-pass-btn:hover { background: var(--surface-hover); color: var(--text-primary); }
.lg-error { color: var(--color-danger); font-size: var(--fs-sm); }
.lg-submit { width: 100%; min-height: 44px; margin-top: var(--space-sm); }
.lg-note { margin-top: var(--space-lg); font-size: var(--fs-xs); color: var(--text-muted); text-align: center; line-height: 1.6; }
.lg-foot { display: flex; justify-content: center; margin-top: var(--space-md); }
</style>
