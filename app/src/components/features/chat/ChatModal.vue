<!-- 对应 legacy chat.js：openChatModal/closeChatModal/chatSwitchTab + index.html 聊天弹窗结构（主弹窗：三 tab 列表 + 聊天区 + 输入区 + 子对话框） -->
<template>
  <Teleport to="body">
    <Transition name="chat">
      <div v-if="store.modalOpen" class="chat-overlay" @mousedown.self="store.closeChatModal()">
        <div class="chat-modal-box" role="dialog" aria-modal="true">
          <button class="chat-close" @click="store.closeChatModal()" aria-label="关闭">
            <Icon name="x" :size="18" />
          </button>
          <div class="chat-modal-body" :class="{ 'chat-showing-room': store.isMobileShowingRoom }">
            <!-- 左侧列表 -->
            <div class="chat-sidebar">
              <div class="chat-sidebar-header">
                <span class="chat-sidebar-title"><Icon name="chat" :size="15" /> 好友</span>
                <div class="chat-sidebar-actions">
                  <button class="chat-icon-btn" title="添加好友" @click="openAddFriend()"><Icon name="user" :size="16" /></button>
                  <button class="chat-icon-btn" title="创建群聊" @click="openCreateGroup()"><Icon name="users" :size="16" /></button>
                </div>
              </div>
              <div class="chat-search-bar">
                <input v-model="store.searchQuery" class="chat-search-input" :placeholder="searchPlaceholder" />
              </div>
              <ChatRoomList v-if="store.activeTab === 'rooms'" />
              <ChatFriendList v-else-if="store.activeTab === 'friends'" />
              <ChatRequestList v-else />
              <div class="chat-sidebar-footer">
                <button class="chat-tab-btn" :class="{ active: store.activeTab === 'rooms' }" @click="store.switchTab('rooms')">会话</button>
                <button class="chat-tab-btn" :class="{ active: store.activeTab === 'friends' }" @click="store.switchTab('friends')">好友</button>
                <button class="chat-tab-btn" :class="{ active: store.activeTab === 'requests' }" @click="store.switchTab('requests')">
                  申请
                  <span v-if="store.pendingRequests > 0" class="chat-tab-badge">{{ store.pendingRequests }}</span>
                </button>
              </div>
            </div>
            <!-- 右侧聊天区 -->
            <div class="chat-main">
              <template v-if="store.openRoomId && store.currentRoom">
                <div class="chat-header">
                  <button class="chat-back-btn" @click="store.backToList()" aria-label="返回">
                    <Icon name="arrow-left" :size="18" />
                  </button>
                  <div class="chat-header-info">
                    <div class="chat-header-name">{{ store.currentRoom.name }}</div>
                    <div v-if="store.headerStatus" class="chat-header-status">{{ store.headerStatus }}</div>
                  </div>
                  <div v-if="store.currentRoom.type === 'group'" class="chat-header-actions">
                    <button class="btn btn-ghost btn-small" @click="openAddMembers()">+ 邀请</button>
                    <button class="btn btn-ghost btn-small danger" @click="store.leaveRoom(store.openRoomId)">退出</button>
                  </div>
                </div>
                <ChatMessages />
                <ChatInput />
              </template>
              <div v-else class="chat-placeholder">
                <div class="chat-placeholder-icon"><Icon name="chat" :size="40" /></div>
                <div class="chat-placeholder-text">选择一个会话开始聊天</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>

  <!-- 分享题选择器 -->
  <ChatShareQuizPicker v-if="store.sharePickerOpen" />

  <!-- 添加好友 -->
  <Modal :open="addFriendOpen" @close="closeAddFriend()">
    <h3 class="sub-title"><Icon name="user" :size="16" /> 添加好友</h3>
    <input v-model="addFriendQuery" class="chat-user-search-input" placeholder="搜索用户名或显示名..." @input="onSearchUsers" />
    <div class="add-friend-results">
      <div v-if="addFriendQuery.trim() === ''" class="chat-user-search-empty">输入关键词搜索用户</div>
      <div v-else-if="searching" class="chat-user-search-empty">搜索中...</div>
      <div v-else-if="addFriendResults.length === 0" class="chat-user-search-empty">未找到用户</div>
      <div v-for="u in addFriendResults" :key="u.id" class="chat-user-search-item">
        <div class="chat-user-search-info">
          <div class="chat-user-search-name">{{ u.display_name || u.username }}</div>
          <div class="chat-user-search-username">@{{ u.username }}</div>
        </div>
        <button class="chat-user-search-add" @click="onAddFriend(u)">添加</button>
      </div>
    </div>
    <div class="dialog-actions">
      <button class="btn btn-secondary btn-small" @click="closeAddFriend()">关闭</button>
    </div>
  </Modal>

  <!-- 创建群聊 -->
  <Modal :open="createGroupOpen" @close="closeCreateGroup()">
    <h3 class="sub-title"><Icon name="users" :size="16" /> 创建群聊</h3>
    <input v-model="groupName" class="chat-user-search-input" placeholder="群聊名称（可选）" maxlength="128" />
    <div class="member-label">选择好友：</div>
    <div class="member-list">
      <div v-for="f in store.friends" :key="f.id" class="chat-member-select-item" :class="{ selected: isSelected(f.id) }" @click="store.toggleSelectedMember(f.id)">
        <div class="chat-member-select-check">{{ isSelected(f.id) ? '✓' : '' }}</div>
        <span>{{ f.display_name || f.username }}</span>
      </div>
      <div v-if="store.friends.length === 0" class="chat-user-search-empty">暂无好友，请先添加好友</div>
    </div>
    <div class="dialog-actions">
      <button class="btn btn-secondary btn-small" @click="closeCreateGroup()">取消</button>
      <button class="btn btn-primary btn-small" @click="doCreateGroup()">创建</button>
    </div>
  </Modal>

  <!-- 邀请成员 -->
  <Modal :open="addMembersOpen" @close="closeAddMembers()">
    <h3 class="sub-title"><Icon name="users" :size="16" /> 邀请好友</h3>
    <div class="member-list">
      <div v-for="f in store.friends" :key="f.id" class="chat-member-select-item" :class="{ selected: isSelected(f.id) }" @click="store.toggleSelectedMember(f.id)">
        <div class="chat-member-select-check">{{ isSelected(f.id) ? '✓' : '' }}</div>
        <span>{{ f.display_name || f.username }}</span>
      </div>
      <div v-if="store.friends.length === 0" class="chat-user-search-empty">暂无好友</div>
    </div>
    <div class="dialog-actions">
      <button class="btn btn-secondary btn-small" @click="closeAddMembers()">取消</button>
      <button class="btn btn-primary btn-small" @click="doAddMembers()">邀请</button>
    </div>
  </Modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import Icon from '../../ui/Icon.vue'
import Modal from '../../ui/Modal.vue'
import ChatRoomList from './ChatRoomList.vue'
import ChatFriendList from './ChatFriendList.vue'
import ChatRequestList from './ChatRequestList.vue'
import ChatMessages from './ChatMessages.vue'
import ChatInput from './ChatInput.vue'
import ChatShareQuizPicker from './ChatShareQuizPicker.vue'
import { useChatStore } from '../../../stores/chat'
import { useUiStore } from '../../../stores/ui'

const store = useChatStore()
const ui = useUiStore()

const searchPlaceholder = computed(() => {
  if (store.activeTab === 'rooms') return '搜索会话...'
  if (store.activeTab === 'friends') return '搜索好友...'
  return ''
})

// —— 添加好友 ——
const addFriendOpen = ref(false)
const addFriendQuery = ref('')
const addFriendResults = ref([])
const searching = ref(false)
let searchTimer = null

function openAddFriend() {
  addFriendQuery.value = ''
  addFriendResults.value = []
  addFriendOpen.value = true
}
function closeAddFriend() { addFriendOpen.value = false }

function onSearchUsers() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    const q = addFriendQuery.value.trim()
    if (!q) { addFriendResults.value = []; return }
    searching.value = true
    try { addFriendResults.value = await store.searchUsers(q) }
    finally { searching.value = false }
  }, 300)
}

async function onAddFriend(u) {
  const message = await ui.openPrompt('发送好友申请', '')
  if (message === null) return
  await store.sendFriendRequest(u.id, message || '')
  addFriendResults.value = addFriendResults.value.filter((x) => x.id !== u.id)
}

// —— 创建群聊 ——
const createGroupOpen = ref(false)
const groupName = ref('')

function openCreateGroup() {
  store.loadFriends()
  store.clearSelectedMembers()
  groupName.value = ''
  createGroupOpen.value = true
}
function closeCreateGroup() { createGroupOpen.value = false; store.clearSelectedMembers() }

function isSelected(id) { return store.selectedMemberIds.indexOf(id) !== -1 }

async function doCreateGroup() {
  const data = await store.createGroupRoom(groupName.value, store.selectedMemberIds.slice())
  if (data) closeCreateGroup()
}

// —— 邀请成员 ——
const addMembersOpen = ref(false)

function openAddMembers() {
  store.loadFriends()
  store.clearSelectedMembers()
  addMembersOpen.value = true
}
function closeAddMembers() { addMembersOpen.value = false; store.clearSelectedMembers() }

async function doAddMembers() {
  if (store.selectedMemberIds.length === 0) {
    ui.toast('请至少选择一位好友', 'err')
    return
  }
  await store.addMembers(store.openRoomId, store.selectedMemberIds.slice())
  closeAddMembers()
}

// 关闭聊天弹窗时顺带关闭子对话框
watch(() => store.modalOpen, (open) => {
  if (!open) {
    addFriendOpen.value = false
    createGroupOpen.value = false
    addMembersOpen.value = false
  }
})
</script>

<style scoped>
.chat-overlay {
  position: fixed;
  inset: 0;
  background: rgba(23, 24, 28, 0.5);
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg);
}
.chat-modal-box {
  position: relative;
  width: 820px;
  max-width: 95vw;
  height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--surface-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.chat-close {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 10;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.chat-close:hover { background: var(--surface-hover); color: var(--text-primary); }

.chat-modal-body { display: flex; flex: 1; min-height: 0; overflow: hidden; }

/* 左侧栏 */
.chat-sidebar {
  width: 280px;
  min-width: 280px;
  display: flex;
  flex-direction: column;
  background: var(--surface-bg);
  border-right: 1px solid var(--border-light);
}
.chat-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}
.chat-sidebar-title { font-size: 15px; font-weight: 600; color: var(--text-primary); display: inline-flex; align-items: center; gap: 6px; }
.chat-sidebar-actions { display: flex; gap: 4px; }
.chat-icon-btn {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}
.chat-icon-btn:hover { background: var(--surface-hover); color: var(--color-primary); }
.chat-search-bar { padding: 8px 12px; border-bottom: 1px solid var(--border-light); flex-shrink: 0; }
.chat-search-input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--surface-card);
  box-sizing: border-box;
  outline: none;
  transition: border-color var(--transition-fast);
}
.chat-search-input:focus { border-color: var(--color-primary); box-shadow: var(--shadow-glow); }
.chat-search-input::placeholder { color: var(--text-muted); }
.chat-sidebar-footer { display: flex; border-top: 1px solid var(--border-light); flex-shrink: 0; }
.chat-tab-btn {
  flex: 1;
  padding: 10px 4px;
  border: none;
  background: none;
  font-size: var(--fs-xs);
  font-family: inherit;
  cursor: pointer;
  color: var(--text-secondary);
  transition: color var(--transition-fast), background var(--transition-fast);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.chat-tab-btn:hover { color: var(--text-primary); background: var(--surface-hover); }
.chat-tab-btn.active { color: var(--color-primary); font-weight: 600; }
.chat-tab-btn.active::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--color-primary);
}
.chat-tab-badge {
  background: var(--color-danger);
  color: #fff;
  border-radius: 10px;
  padding: 0 5px;
  font-size: 9px;
  font-weight: 600;
  line-height: 15px;
  min-width: 15px;
  text-align: center;
}

/* 右侧聊天区 */
.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--surface-bg);
}
.chat-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--text-muted);
}
.chat-placeholder-icon { font-size: 48px; opacity: 0.4; }
.chat-placeholder-text { font-size: var(--fs-base); }
.chat-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 48px 10px 14px;
  background: var(--surface-card);
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}
.chat-back-btn {
  display: none;
  width: 30px;
  height: 30px;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  cursor: pointer;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  flex-shrink: 0;
}
.chat-back-btn:hover { background: var(--surface-hover); }
.chat-header-info { flex: 1; min-width: 0; }
.chat-header-name {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-header-status { font-size: 11px; color: var(--text-muted); }
.chat-header-actions { display: flex; gap: 4px; flex-shrink: 0; }
.chat-header-actions .danger:hover { border-color: var(--color-danger); color: var(--color-danger); }

/* 子对话框 */
.sub-title { margin: 0 0 12px; font-size: var(--fs-md); font-weight: 600; }
.chat-user-search-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: var(--fs-sm);
  font-family: inherit;
  color: var(--text-primary);
  background: var(--surface-bg);
  box-sizing: border-box;
  outline: none;
  margin-bottom: 8px;
}
.chat-user-search-input:focus { border-color: var(--color-primary); box-shadow: var(--shadow-glow); }
.chat-user-search-input::placeholder { color: var(--text-muted); }
.add-friend-results { max-height: 240px; overflow-y: auto; }
.chat-user-search-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast);
}
.chat-user-search-item:hover { background: var(--surface-hover); }
.chat-user-search-info { flex: 1; min-width: 0; }
.chat-user-search-name { font-size: var(--fs-sm); font-weight: 500; color: var(--text-primary); }
.chat-user-search-username { font-size: 11px; color: var(--text-muted); }
.chat-user-search-add {
  padding: 4px 10px;
  border: 1px solid var(--color-primary);
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-primary);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.chat-user-search-add:hover { background: var(--color-primary); color: #fff; }
.chat-user-search-empty { text-align: center; padding: 20px; color: var(--text-muted); font-size: var(--fs-xs); }

.member-label { font-size: var(--fs-xs); color: var(--text-secondary); margin-bottom: 8px; }
.member-list { max-height: 200px; overflow-y: auto; margin-bottom: 10px; }
.chat-member-select-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
  font-size: var(--fs-sm);
  color: var(--text-primary);
}
.chat-member-select-item:hover { background: var(--surface-hover); }
.chat-member-select-item.selected { background: var(--color-primary-light); }
.chat-member-select-check {
  width: 18px;
  height: 18px;
  border: 2px solid var(--border-default);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}
.chat-member-select-item.selected .chat-member-select-check {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

/* 过渡动画 */
.chat-enter-active, .chat-leave-active { transition: opacity 0.2s ease; }
.chat-enter-active .chat-modal-box, .chat-leave-active .chat-modal-box { transition: transform 0.2s ease; }
.chat-enter-from, .chat-leave-to { opacity: 0; }
.chat-enter-from .chat-modal-box, .chat-leave-to .chat-modal-box { transform: translateY(12px) scale(0.98); }

/* 移动端：单栏切换（语义同 legacy responsive.css） */
@media (max-width: 768px) {
  .chat-modal-box {
    width: 100vw;
    height: 100vh;
    height: 100dvh;
    max-width: 100vw;
    border-radius: 0;
  }
  .chat-overlay { padding: 0; }
  .chat-sidebar { width: 100%; min-width: 100%; }
  .chat-main { display: none; }
  .chat-modal-body.chat-showing-room .chat-sidebar { display: none; }
  .chat-modal-body.chat-showing-room .chat-main { display: flex; }
  .chat-back-btn { display: flex !important; }
}
</style>
