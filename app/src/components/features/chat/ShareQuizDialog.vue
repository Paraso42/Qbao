<!-- 分享题目到好友/群聊（自 legacy chat.js _showQuizShareTargetSelector 等迁移） -->
<template>
  <Modal :open="ui.quizShare.open" @close="ui.closeQuizShare">
    <h3 class="sq-title">分享题目给</h3>
    <div class="sq-list">
      <div v-if="friends.length > 0" class="sq-section">好友</div>
      <div v-for="f in friends" :key="f.id" class="sq-item" @click="shareToFriend(f)">
        <span class="sq-avatar direct">{{ (f.display_name || f.username).charAt(0).toUpperCase() }}</span>
        <span class="sq-name">{{ f.display_name || f.username }}</span>
      </div>

      <div v-if="groups.length > 0" class="sq-section">群聊</div>
      <div v-for="g in groups" :key="g.id" class="sq-item" @click="shareToRoom(g.id)">
        <span class="sq-avatar group">{{ (g.name || '群聊').charAt(0).toUpperCase() }}</span>
        <span class="sq-name">{{ g.name || '群聊' }}</span>
      </div>

      <div v-if="friends.length === 0 && groups.length === 0 && !loading" class="sq-empty">暂无好友或群聊</div>
      <div v-if="loading" class="sq-empty">加载中…</div>
    </div>
  </Modal>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useUiStore } from '../../../stores/ui'
import { useChatStore } from '../../../stores/chat'
import { useUserStore } from '../../../stores/user'
import Modal from '../../ui/Modal.vue'

const ui = useUiStore()
const chat = useChatStore()
const user = useUserStore()

const loading = ref(false)

const friends = computed(() => chat.friends || [])
const rooms = computed(() => chat.roomsCache || [])
const groups = computed(() => rooms.value.filter((r) => r.type === 'group'))

watch(() => ui.quizShare.open, async (open) => {
  if (!open) return
  loading.value = true
  try {
    await chat.loadFriends()
    await chat.loadRooms()
  } catch (e) { /* ignore */ }
  loading.value = false
})

function friendRoomMap() {
  const map = {}
  rooms.value.forEach((room) => {
    if (room.type === 'direct' && room.members) {
      room.members.forEach((m) => {
        if (m.id !== user.userId) map[m.id] = room.id
      })
    }
  })
  return map
}

async function shareToFriend(f) {
  const roomId = friendRoomMap()[f.id]
  try {
    if (roomId) {
      await chat.sendMessage({ roomId, content: '', msgType: 'quiz_share', quizData: ui.quizShare.data })
    } else {
      await chat.createDirectRoom(f.id)
      const newRoomId = await findRoomId(f.id)
      if (!newRoomId) throw new Error('创建会话失败')
      await chat.sendMessage({ roomId: newRoomId, content: '', msgType: 'quiz_share', quizData: ui.quizShare.data })
      await chat.loadRooms()
    }
    ui.toast('已分享', 'ok')
    ui.closeQuizShare()
  } catch (e) {
    ui.toast('分享失败: ' + (e.message || '请重试'), 'err')
  }
}

async function shareToRoom(roomId) {
  try {
    await chat.sendMessage({ roomId, content: '', msgType: 'quiz_share', quizData: ui.quizShare.data })
    ui.toast('已分享', 'ok')
    ui.closeQuizShare()
  } catch (e) {
    ui.toast('分享失败: ' + (e.message || '请重试'), 'err')
  }
}

async function findRoomId(friendId) {
  await chat.loadRooms()
  const map = friendRoomMap()
  return map[friendId] || null
}
</script>

<style scoped>
.sq-title { margin-bottom: var(--space-md); }
.sq-list { max-height: 50vh; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.sq-section { font-size: var(--fs-xs); color: var(--text-muted); padding: 8px 4px 2px; }
.sq-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 8px 12px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast);
}
.sq-item:hover { background: var(--color-primary-light); }
.sq-avatar {
  width: 32px; height: 32px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: var(--fs-sm); font-weight: 600;
  flex-shrink: 0;
}
.sq-avatar.direct { background: var(--color-primary-light); color: var(--color-primary); }
.sq-avatar.group { background: var(--color-warning-light); color: var(--color-warning); }
.sq-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sq-empty { color: var(--text-muted); text-align: center; padding: var(--space-lg); font-size: var(--fs-sm); }
</style>
