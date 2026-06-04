function showScreen(name){
  closeAllModals();
  // 弹窗类路由
  if (name === 'quiz')      { openQuizModal('quiz'); return; }
  if (name === 'report')    { openQuizModal('report'); return; }
  if (name === 'settings')  { openSettingsModal(); return; }
  if (name === 'achievements') { openUserCenterModal('achievements'); return; }
  if (name.startsWith('uc-'))  { openUserCenterModal(name.replace('uc-','')); return; }
  // 全屏页面
  document.querySelectorAll('.screen').forEach(function(el){ el.classList.remove('active'); });
  var t = document.getElementById('screen-' + name);
  if (t) t.classList.add('active');
  state.lastScreen = name;
  updateBreadcrumb(name);
  saveState();
}

function closeAllModals() {
  document.querySelectorAll('.dialog-overlay.active').forEach(function(el){ el.classList.remove('active'); });
}

function openQuizModal(view) {
  closeAllModals();
  document.getElementById('quiz-modal').classList.add('active');
  var quizView = document.getElementById('quiz-modal-view-quiz');
  var reportView = document.getElementById('quiz-modal-view-report');
  var closeBtn = document.getElementById('quiz-modal-close-btn');
  if (view === 'report') {
    quizView.style.display = 'none';
    reportView.style.display = 'block';
    closeBtn.style.display = 'block';
    state.lastScreen = 'report';
    updateBreadcrumb('report');
  } else {
    quizView.style.display = 'block';
    reportView.style.display = 'none';
    closeBtn.style.display = 'none';
    state.lastScreen = 'quiz';
    updateBreadcrumb('quiz');
    renderQuestion();
    updateProgress();
  }
  saveState();
}

function closeQuizModal() {
  var as = getActiveSet();
  if (as && as.userAnswers) {
    var answered = as.userAnswers.filter(function(a) { return a !== undefined; }).length;
    if (answered > 0 && as.questions && answered < as.questions.length) {
      if (!confirm('你还有未完成的题目，确定要退出吗？已答题目将保留。')) return;
    }
  }
  document.getElementById('quiz-modal').classList.remove('active');
  showScreen('start');
  updateQuickActions();
}

function updateBreadcrumb(screenName) {
  updateTopbarAiIndicator();
}

function updateTopbarAiIndicator() {
  var el = document.getElementById('topbar-ai-indicator');
  if (!el) return;
  var queue = state.aiTaskQueue || [];
  var running = queue.filter(function(t){ return t.status === 'running'; }).length;
  var pending = queue.filter(function(t){ return t.status === 'pending'; }).length;
  if (running > 0) {
    el.style.display = 'flex';
    el.className = 'tb-ai-indicator running';
    el.textContent = running + ' 任务运行中';
    el.title = running + ' AI 任务运行中, ' + pending + ' 等待中';
  } else if (pending > 0) {
    el.style.display = 'flex';
    el.className = 'tb-ai-indicator running';
    el.textContent = pending + ' 任务等待中';
    el.title = pending + ' AI 任务等待中';
  } else if (state.aiEnabled) {
    el.style.display = 'flex';
    el.className = 'tb-ai-indicator idle';
    el.textContent = 'AI 就绪';
    el.title = 'AI 模式已开启，无进行中任务';
  } else {
    el.style.display = 'none';
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
  var ov = document.getElementById('sidebar-overlay');
  if (ov) ov.classList.toggle('active');
  setTimeout(function() { if (typeof positionCardBottomBar === 'function') positionCardBottomBar(); }, 350);
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  var ov = document.getElementById('sidebar-overlay');
  if (ov) ov.classList.remove('active');
  setTimeout(function() { if (typeof positionCardBottomBar === 'function') positionCardBottomBar(); }, 350);
}
function closeSidebarIfMobile() {
  if (window.innerWidth <= 768) closeSidebar();
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    closeAllModals();
  }
});

document.addEventListener('DOMContentLoaded', init);
