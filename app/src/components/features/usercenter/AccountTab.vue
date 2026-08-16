<!--
  AccountTab.vue — 账号管理（自 legacy users.js renderAccountPage/uploadAvatar/saveAccountChanges）
  头像（选图→裁剪→PUT）、显示名称、修改密码、存储积分。
-->
<template>
  <div class="account-tab">
    <div class="section">
      <h4>📷 头像</h4>
      <div class="avatar-upload-area">
        <div class="avatar-preview">
          <img v-if="avatarUrl" :src="avatarUrl" alt="">
          <span v-else>{{ initial }}</span>
        </div>
        <div class="avatar-actions">
          <button class="btn btn-primary btn-small" @click="pickAvatar">上传头像</button>
          <input ref="fileInputRef" type="file" accept="image/*" hidden @change="onPickFile">
        </div>
      </div>
    </div>

    <div class="section">
      <h4>✏️ 显示名称</h4>
      <input v-model="displayName" class="input" type="text" placeholder="输入显示名称">
    </div>

    <div class="section">
      <h4>🔒 修改密码</h4>
      <div class="pw-fields">
        <input v-model="oldPassword" class="input" type="password" placeholder="当前密码" autocomplete="current-password">
        <input v-model="newPassword" class="input" type="password" placeholder="新密码（至少6位）" autocomplete="new-password">
        <input v-model="newPassword2" class="input" type="password" placeholder="确认新密码" autocomplete="new-password">
      </div>
    </div>

    <div class="section">
      <h4>📦 存储积分</h4>
      <div class="storage-row">
        <span class="storage-num">{{ users.storagePoints }}</span>
        <span class="storage-hint">积分可用于延长文件池存储时间（10积分/7天）</span>
      </div>
    </div>

    <button class="btn btn-primary account-save" :disabled="users.accountBusy" @click="save">
      💾 {{ users.accountBusy ? '保存中…' : '保存更改' }}
    </button>

    <AvatarCropDialog :open="cropOpen" :src="cropSrc" @close="onCropClose" @confirm="onCropConfirm" />
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useUserStore } from '../../../stores/user'
import { useUsersStore } from '../../../stores/users'
import { useUiStore } from '../../../stores/ui'
import AvatarCropDialog from './AvatarCropDialog.vue'

const user = useUserStore()
const users = useUsersStore()
const ui = useUiStore()

const displayName = ref((user.user && user.user.displayName) || '')
const oldPassword = ref('')
const newPassword = ref('')
const newPassword2 = ref('')

const fileInputRef = ref(null)
const cropOpen = ref(false)
const cropSrc = ref('')
const objectUrl = ref(null)

const avatarUrl = computed(() => (user.user && (user.user.avatarUrl || user.user.avatar)) || '')
const initial = computed(() => ((user.user && (user.user.displayName || user.user.username)) || '?').charAt(0).toUpperCase())

function pickAvatar() { if (fileInputRef.value) fileInputRef.value.click() }

function revokeObjectUrl() {
  if (objectUrl.value) { URL.revokeObjectURL(objectUrl.value); objectUrl.value = null }
}

function onPickFile(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (!file.type.startsWith('image/')) { ui.toast('请选择图片文件', 'err'); return }
  if (file.size > 5 * 1024 * 1024) { ui.toast('图片不能超过 5MB', 'err'); return }
  revokeObjectUrl()
  objectUrl.value = URL.createObjectURL(file)
  cropSrc.value = objectUrl.value
  cropOpen.value = true
}

function onCropClose() {
  cropOpen.value = false
  revokeObjectUrl()
  cropSrc.value = ''
}

async function onCropConfirm(dataUrl) {
  cropOpen.value = false
  revokeObjectUrl()
  cropSrc.value = ''
  await users.uploadAvatarData(dataUrl)
}

async function save() {
  const name = displayName.value.trim()
  if (!name) { ui.toast('显示名称不能为空', 'err'); return }
  if (oldPassword.value || newPassword.value || newPassword2.value) {
    if (!oldPassword.value) { ui.toast('修改密码需输入当前密码', 'err'); return }
    if (newPassword.value.length < 6) { ui.toast('新密码至少6位', 'err'); return }
    if (newPassword.value !== newPassword2.value) { ui.toast('两次输入的新密码不一致', 'err'); return }
  }
  const res = await users.saveAccount({ displayName: name, oldPassword: oldPassword.value, newPassword: newPassword.value })
  if (res && res.ok) {
    oldPassword.value = ''
    newPassword.value = ''
    newPassword2.value = ''
    ui.toast('保存成功', 'ok')
  }
}
</script>

<style scoped>
.account-tab { display: flex; flex-direction: column; gap: var(--space-md); }
.section {
  background: var(--surface-bg);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-lg);
}
.section h4 {
  margin: 0 0 var(--space-md);
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.avatar-upload-area { display: flex; align-items: center; gap: var(--space-md); }
.avatar-preview {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  background: var(--surface-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}
.avatar-preview img { width: 100%; height: 100%; object-fit: cover; }
.avatar-preview span { font-size: 24px; color: var(--text-muted); }
.avatar-actions { display: flex; flex-direction: column; gap: var(--space-xs); }
.pw-fields { display: flex; flex-direction: column; gap: var(--space-sm); }
.storage-row { display: flex; align-items: center; gap: var(--space-md); }
.storage-num { font-size: var(--fs-2xl); font-weight: 700; color: var(--color-primary); }
.storage-hint { font-size: var(--fs-sm); color: var(--text-secondary); }
.account-save { width: 100%; }
</style>
