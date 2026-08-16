<!-- 对应 legacy chat.js：chatRenderRoomList（会话列表） -->
<template>
  <div class="chat-room-list">
    <div v-if="store.roomList.length === 0" class="chat-room-empty">暂无会话<br>添加好友开始聊天吧</div>
    <div
      v-for="room in store.roomList"
      :key="room.id"
      class="chat-room-item"
      :class="{ active: room.active }"
      @click="store.openRoom(room.id)"
    >
      <div class="chat-avatar" :class="room.type">
        <img v-if="room.otherAvatar && !failedImgs[room.otherAvatar]" :src="room.otherAvatar" @error="imgError(room.otherAvatar)" />
        <span v-else>{{ room.initial }}</span>
      </div>
      <div class="chat-room-info">
        <div class="chat-room-name">{{ room.name }}</div>
        <div v-if="room.preview" class="chat-room-last-msg">{{ room.preview }}</div>
      </div>
      <div class="chat-room-meta">
        <div v-if="room.time" class="chat-room-time">{{ room.time }}</div>
        <div v-if="room.unread > 0" class="chat-room-badge">{{ room.unread > 99 ? '99+' : room.unread }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useChatStore } from '../../../stores/chat'

const store = useChatStore()
const failedImgs = ref({})

function imgError(url) {
  if (url) failedImgs.value = { ...failedImgs.value, [url]: true }
}
</script>

<style scoped>
.chat-room-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.chat-room-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background var(--transition-fast);
  position: relative;
}
.chat-room-item:hover { background: var(--surface-hover); }
.chat-room-item.active { background: var(--color-primary-light); }
.chat-avatar {
  width: 40px;
  height: 40px;
  min-width: 40px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
  overflow: hidden;
}
.chat-avatar.direct { background: var(--gradient-primary); }
.chat-avatar.group { background: linear-gradient(135deg, var(--exam-color-4), var(--exam-color-5)); }
.chat-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.chat-room-info { flex: 1; min-width: 0; }
.chat-room-name {
  font-size: var(--fs-sm);
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-room-last-msg {
  font-size: 11px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
}
.chat-room-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}
.chat-room-time { font-size: 10px; color: var(--text-muted); white-space: nowrap; }
.chat-room-badge {
  background: var(--color-danger);
  color: #fff;
  border-radius: 10px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  min-width: 16px;
  text-align: center;
}
.chat-room-empty {
  text-align: center;
  padding: 30px 14px;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  line-height: var(--lh-relaxed);
}
</style>
