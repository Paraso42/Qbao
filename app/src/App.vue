<template>
  <div id="app">
    <AppTopbar />
    <div id="app-body">
      <AppSidebar />
      <main id="main">
        <StartView />
      </main>
    </div>
    <ToastHost />
  </div>
</template>

<script setup>
import AppTopbar from './components/layout/AppTopbar.vue'
import AppSidebar from './components/layout/AppSidebar.vue'
import StartView from './views/StartView.vue'
import ToastHost from './components/ui/ToastHost.vue'
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
}
</style>
