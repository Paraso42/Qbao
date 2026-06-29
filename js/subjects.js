
function showInlinePrompt(title, defaultValue, callback) {
  var overlay = document.createElement('div');
  overlay.className = 'dialog-overlay active';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:2000;';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div class="dialog-box" style="max-width:380px;" onclick="event.stopPropagation()">'
    + '<h3 style="margin-bottom:10px;">' + title + '</h3>'
    + '<input type="text" id="inline-prompt-input" style="width:100%;padding:10px;border:1px solid #dee2e6;border-radius:6px;font-size:15px;">'
    + '<div class="dialog-actions" style="margin-top:14px;">'
    + '<button class="btn btn-secondary btn-small" id="inline-prompt-cancel">取消</button>'
    + '<button class="btn btn-primary btn-small" id="inline-prompt-ok">确定</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  var input = document.getElementById('inline-prompt-input');
  input.value = defaultValue || '';
  input.focus(); input.select();
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') document.getElementById('inline-prompt-ok').click(); });
  document.getElementById('inline-prompt-cancel').onclick = function() { overlay.remove(); };
  document.getElementById('inline-prompt-ok').onclick = function() {
    var val = input.value.trim();
    overlay.remove();
    if (val) callback(val);
  };
}

function createSubject() {
  var defaultName = '科目 ' + (Object.keys(state.subjects).length + 1);
  showInlinePrompt('新建科目', defaultName, function(name) {
  const id = 'subj_' + Date.now().toString(36);
  state.subjects[id] = { id: id, name: name.trim(), chapterIds: [], collapsed: false };
  if (!state.currentSubjectId) state.currentSubjectId = id;
  if (!state.subjectOrder) state.subjectOrder = Object.keys(state.subjects);
  state.subjectOrder.push(id);
  saveState(); renderSubjectList(); checkAchievements();
  });
}
function renameSubject(id) { var s = state.subjects[id]; if (!s) return; showInlinePrompt('重命名科目', s.name, function(n) { s.name = n; saveState(); renderSubjectList(); }); }
function deleteSubject(id) {
  const s = state.subjects[id]; if (!s) return;
  if (!confirm('删除科目「' + s.name + '」及其所有章节？')) return;
  s.chapterIds.forEach(cid => { delete state.chapters[cid]; });
  delete state.subjects[id];
  var orderIdx = (state.subjectOrder || []).indexOf(id);
  if (orderIdx !== -1) state.subjectOrder.splice(orderIdx, 1);
  const keys = Object.keys(state.subjects);
  if (keys.length === 0) { const sid2 = 'subj_' + Date.now().toString(36); state.subjects[sid2] = { id: sid2, name: '默认科目', chapterIds: [] }; state.currentSubjectId = sid2; }
  else if (state.currentSubjectId === id) { state.currentSubjectId = keys[0]; state.currentChapterId = state.subjects[keys[0]].chapterIds[0] || null; }
  saveState(); renderSubjectList(); updateQuickActions();
}
function switchSubject(id) {
  if (!state.subjects[id]) return;
  state.currentSubjectId = id;
  // 保留 currentChapterId，不清除 — 切换回主页时恢复上次章节
  saveState(); renderSubjectList(); updateQuickActions(); loadChapterStrategyToUI(); renderAiMaterialList(); updateAiMaterialCount();
  showSubjectDashboard(id);
}
// ===== 章节管理 =====
function createChapter(subjId, name) {
  var s = state.subjects[subjId]; if (!s) return null;
  if (name) {
    _doCreateChapter(subjId, name);
  } else {
    var defaultName = '章节 ' + (s.chapterIds.length + 1);
    showInlinePrompt('新建章节', defaultName, function(n) { _doCreateChapter(subjId, n); });
  }
  return null;
}
function _doCreateChapter(subjId, name) {
  var s = state.subjects[subjId]; if (!s) return;
  var id = 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2,4);
  state.chapters[id] = { id: id, name: name, questions: [], userAnswers: [], currentIdx: 0, createdAt: Date.now(), strategy: { errPct: 20, reviewPct: 50, newPct: 30, typeCounts: { single: 5, judge: 5, term: 3, short: 2 }, weakTags: [] } };
  s.chapterIds.push(id); state.currentChapterId = id;
  saveState(); renderSubjectList(); updateQuickActions(); loadChapterStrategyToUI(); checkAchievements();
}
function switchChapter(chId) { if (!state.chapters[chId]) return; state.currentChapterId = chId; for (var sid in state.subjects) { if (state.subjects[sid].chapterIds.indexOf(chId) !== -1) { state.currentSubjectId = sid; if (state.subjects[sid].collapsed) { state.subjects[sid].collapsed = false; } break; } } saveState(); renderSubjectList(); showScreen('start'); setTimeout(function(){ updateQuickActions(); updateChapterProgress(); loadChapterStrategyToUI(); renderAiMaterialList(); updateAiMaterialCount(); }, 10); restoreQuizFromServer().then(function() { updateQuickActions(); renderSubjectList(); }); }
function renameChapter(chId, newName) { const ch = state.chapters[chId]; if (!ch || !newName || !newName.trim()) return; ch.name = newName.trim(); saveState(); renderSubjectList(); }
function deleteChapter(chId) {
  if (!confirm('删除该章节？')) return;
  delete state.chapters[chId];
  for (const sid in state.subjects) { const s = state.subjects[sid]; const idx = s.chapterIds.indexOf(chId); if (idx !== -1) { s.chapterIds.splice(idx, 1); break; } }
  if (state.currentChapterId === chId) { const s = getSubj(); state.currentChapterId = (s && s.chapterIds.length > 0) ? s.chapterIds[0] : null; }
  saveState(); renderSubjectList(); updateQuickActions(); showScreen('start');
}
function renameChapterPrompt(chId) { var ch = state.chapters[chId]; if (!ch) return; showInlinePrompt('重命名章节', ch.name, function(n) { renameChapter(chId, n); }); }

function toggleSubjectCollapse(sid, event) {
  if (event) event.stopPropagation();
  const s = state.subjects[sid];
  if (!s) return;
  s.collapsed = !s.collapsed;
  saveState();
  // Instant DOM update — no full re-render, preserves scroll position
  const group = document.querySelector('.subject-group[data-subject-id="' + sid + '"]');
  if (!group) return;
  const arrow = group.querySelector('.subj-collapse-arrow');
  if (s.collapsed) {
    group.classList.add('collapsed');
    if (arrow) arrow.textContent = '▶';
  } else {
    group.classList.remove('collapsed');
    if (arrow) arrow.textContent = '▼';
  }
}
// ===== 排序 =====
function moveSubjectToTop(sid) {
  var arr = state.subjectOrder || Object.keys(state.subjects);
  var idx = arr.indexOf(sid);
  if (idx <= 0) return;
  arr.splice(idx, 1);
  arr.unshift(sid);
  state.subjectOrder = arr;
  saveState(); renderSubjectList();
}
function moveChapterToTop(subjId, cid) {
  var s = state.subjects[subjId]; if (!s) return;
  var idx = s.chapterIds.indexOf(cid);
  if (idx <= 0) return;
  s.chapterIds.splice(idx, 1);
  s.chapterIds.unshift(cid);
  saveState(); renderSubjectList();
}
// ===== 侧边栏渲染 =====
function renderSubjectList() {
  const container = document.getElementById('subject-list');
  if (!container) return;
  const sids = state.subjectOrder || Object.keys(state.subjects);
  if (sids.length === 0) { container.innerHTML = '<div style="color:#666;text-align:center;padding:14px;font-size:13px;">暂无科目<br>点击上方「＋科目」</div>'; return; }
  let html = '';
  sids.forEach((sid, sidIdx) => {
    const s = state.subjects[sid]; const active = sid === state.currentSubjectId ? 'active' : '';
    const collapsedClass = s.collapsed ? ' collapsed' : '';
    html += '<div class="subject-group' + collapsedClass + '" data-subject-id="' + sid + '"><div class="subject-header ' + active + '" onclick="switchSubject(\'' + sid + '\')">';
    html += '<span class="subj-collapse-arrow" onclick="toggleSubjectCollapse(\'' + sid + '\', event)">' + (s.collapsed ? '▶' : '▼') + '</span>';
    html += '<span class="subj-name">📂 ' + escapeHtml(s.name) + '</span><span class="subj-count">' + s.chapterIds.length + '</span>';
    html += '<span class="subj-actions"><button class="subj-btn sb-top" title="置顶" onclick="event.stopPropagation();moveSubjectToTop(\'' + sid + '\')"' + (sidIdx === 0 ? ' disabled style="visibility:hidden"' : '') + '>⬆</button><button class="subj-btn" title="重命名" onclick="event.stopPropagation();renameSubject(\'' + sid + '\')">✏️</button><button class="subj-btn sb-del" title="删除" onclick="event.stopPropagation();deleteSubject(\'' + sid + '\')">🗑️</button></span></div>';
    html += '<div class="chapter-list-in-subj">';
    if (s.chapterIds.length > 0) {
      s.chapterIds.forEach(cid => {
        const ch = state.chapters[cid]; if (!ch) return;
        const ca = cid === state.currentChapterId ? 'active' : ''; const setCount = ch.quizSets ? ch.quizSets.length : 0;
        let totalAnswered = 0; let totalQuestions = 0;
        (ch.quizSets || []).forEach(function(set) {
          totalQuestions += set.questions.length;
          if (set.userAnswers) {
            totalAnswered += set.userAnswers.filter(function(a) { return a !== undefined && a !== -1; }).length;
          }
        });
        html += '<div class="chapter-item ' + ca + '" ondblclick="event.stopPropagation();renameChapterPrompt(\'' + cid + '\')" onclick="closeSidebarIfMobile();switchChapter(\'' + cid + '\')"><div class="chapter-info"><span class="chapter-name">' + escapeHtml(ch.name) + '</span><span class="chapter-count">' + totalAnswered + ' 题已答</span></div>';
        var isFirstCh2 = s.chapterIds.length > 1 && cid === s.chapterIds[0];
        html += '<div class="ch-actions"><button class="ch-btn ch-top" title="置顶" onclick="event.stopPropagation();moveChapterToTop(\'' + sid + '\',\'' + cid + '\')"' + (isFirstCh2 ? ' disabled style="visibility:hidden"' : '') + '>⬆</button><button class="ch-btn" title="重命名" onclick="event.stopPropagation();renameChapterPrompt(\'' + cid + '\')">✏️</button><button class="ch-btn ch-del" title="删除" onclick="event.stopPropagation();deleteChapter(\'' + cid + '\')">🗑️</button></div></div>';
      });
    }
    html += '<button class="btn-add-chapter" onclick="event.stopPropagation();createChapter(\'' + sid + '\')">＋ 新建章节</button></div></div>';
  });
  container.innerHTML = html;
}
