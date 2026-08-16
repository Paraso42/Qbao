<!-- 对应 legacy chat.js：chatRenderFriendList（好友列表） -->
<template>
  <div class="chat-room-list">
    <div v-if="store.friendList.length === 0" class="chat-room-empty">暂无好友<br>点击左上角 ➕ 添加好友</div>
    <div v-for="friend in store.friendList" :key="friend.id" class="chat-friend-item">
      <div class="chat-avatar">
        <img v-if="friend.avatar_url && !failedImgs[friend.avatar_url]" :src="friend.avatar_url" @error="imgError(friend.avatar_url)" />
        <span v-else>{{ friend.initial }}</span>
      </div>
      <div class="chat-friend-info">
        <div class="chat-friend-name">{{ friend.name }}</div>
        <div class="chat-friend-status">{{ friend.online ? '在线' : '离线' }}</div>
      </div>
      <span class="chat-friend-online" :class="friend.online ? 'online' : 'offline'"></span>
      <div class="chat-friend-actions">
        <button class="chat-friend-action-btn" @click.stop="store.createDirectRoom(friend.id)">发消息</button>
        <button class="chat-friend-action-btn danger" @click.stop="store.deleteFriend(friend.id, friend.name)">删除</button>
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
.chat-friend-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background var(--transition-fast);
}
.chat-friend-item:hover { background: var(--surface-hover); }
.chat-avatar {
  width: 36px;
  height: 36px;
  min-width: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 700;
  color: #fff;
  background: var(--gradient-primary);
  overflow: hidden;
}
.chat-avatar img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; }
.chat-friend-info { flex: 1; min-width: 0; }
.chat-friend-name { font-size: var(--fs-sm); font-weight: 500; color: var(--text-primary); }
.chat-friend-status { font-size: 10px; color: var(--text-muted); }
.chat-friend-online {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.chat-friend-online.online { background: var(--color-success); }
.chat-friend-online.offline { background: var(--border-default); }
.chat-friend-actions { display: flex; gap: 4px; }
.chat-friend-action-btn {
  font-size: 10px;
  padding: 3px 8px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: var(--surface-card);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: inherit;
}
.chat-friend-action-btn:hover { border-color: var(--color-primary); color: var(--color-primary); }
.chat-friend-action-btn.danger:hover { border-color: var(--color-danger); color: var(--color-danger); }
.chat-room-empty {
  text-align: center;
  padding: 30px 14px;
  color: var(--text-muted);
  font-size: var(--fs-xs);
  line-height: var(--lh-relaxed);
}
</style>
