<!-- 对应 legacy chat.js：chatRenderRequestList（好友申请列表） -->
<template>
  <div class="chat-room-list">
    <div v-if="store.requestList.length === 0" class="chat-room-empty">暂无好友申请</div>
    <div v-for="req in store.requestList" :key="req.id" class="chat-request-item">
      <div class="chat-avatar">{{ req.initial }}</div>
      <div class="chat-request-info">
        <div class="chat-request-name">{{ req.name }}</div>
        <div v-if="req.message" class="chat-request-message">{{ req.message }}</div>
      </div>
      <div class="chat-request-actions">
        <button class="chat-request-accept" @click="store.acceptRequest(req.id)">接受</button>
        <button class="chat-request-reject" @click="store.rejectRequest(req.id)">拒绝</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useChatStore } from '../../../stores/chat'
const store = useChatStore()
</script>

<style scoped>
.chat-room-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.chat-request-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-light);
}
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
}
.chat-request-info { flex: 1; min-width: 0; }
.chat-request-name { font-size: var(--fs-sm); font-weight: 500; color: var(--text-primary); }
.chat-request-message {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chat-request-actions { display: flex; gap: 4px; flex-shrink: 0; }
.chat-request-accept {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: var(--color-primary);
  color: #fff;
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.chat-request-accept:hover { background: var(--color-primary-hover); }
.chat-request-reject {
  padding: 4px 10px;
  border: 1px solid var(--border-default);
  border-radius: 4px;
  background: none;
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
  font-family: inherit;
}
.chat-request-reject:hover { border-color: var(--color-danger); color: var(--color-danger); }
.chat-room-empty {
  text-align: center;
  padding: 30px 14px;
  color: var(--text-muted);
  font-size: var(--fs-xs);
}
</style>
