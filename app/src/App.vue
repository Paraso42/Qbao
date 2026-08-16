<template>
  <div id="app">
    <AppTopbar />
    <div id="app-body">
      <AppSidebar />
      <main id="main">
        <StartView v-if="ui.activeScreen === 'start'" />
        <HistoryView v-else-if="ui.activeScreen === 'history'" />
        <SubjectDashView v-else-if="ui.activeScreen === 'subject-dash'" />
      </main>
    </div>

    <!-- 全局弹层 -->
    <AuthDialog />
    <SettingsModal />
    <AiTaskQueueDialog />
    <QuizView />
    <ImportDialog />
    <ChatModal />
    <UserCenterModal />
    <FeedbackBubble />
    <ToastHost />
    <ConfirmDialog />
    <PromptDialog />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { useUiStore } from './stores/ui'
import { useAiStore } from './stores/ai'
import AppTopbar from './components/layout/AppTopbar.vue'
import AppSidebar from './components/layout/AppSidebar.vue'
import StartView from './views/StartView.vue'
import HistoryView from './views/HistoryView.vue'
import SubjectDashView from './views/SubjectDashView.vue'
import QuizView from './views/QuizView.vue'
import AuthDialog from './components/features/auth/AuthDialog.vue'
import SettingsModal from './components/features/settings/SettingsModal.vue'
import AiTaskQueueDialog from './components/features/ai/AiTaskQueueDialog.vue'
import ImportDialog from './components/features/quiz/ImportDialog.vue'
import ChatModal from './components/features/chat/ChatModal.vue'
import UserCenterModal from './components/features/usercenter/UserCenterModal.vue'
import FeedbackBubble from './components/features/issues/FeedbackBubble.vue'
import ToastHost from './components/ui/ToastHost.vue'
import ConfirmDialog from './components/ui/ConfirmDialog.vue'
import PromptDialog from './components/ui/PromptDialog.vue'

const ui = useUiStore()
const ai = useAiStore()

onMounted(() => {
  ai.ensureProviders()
})
</script>

<style scoped>
#app { display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden; }
#app-body { display: flex; flex: 1; overflow: hidden; }
#main {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3xl);
  max-width: var(--main-max-width);
  margin: 0 auto;
  width: 100%;
  font-size: var(--main-font-size, 16px);
}
</style>
