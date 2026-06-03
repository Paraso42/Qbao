function createSubject() {
  const name = prompt('科目名称：', '科目 ' + (Object.keys(state.subjects).length + 1));
  if (!name || !name.trim()) return;
  const id = 'subj_' + Date.now().toString(36);
  state.subjects[id] = { id, name: name.trim(), chapterIds: [] };
  if (!state.currentSubjectId) state.currentSubjectId = id;
  saveState(); renderSubjectList(); checkAchievements();
}
function renameSubject(id) { const s = state.subjects[id]; if (!s) return; const n = prompt('新名称：', s.name); if (n && n.trim()) { s.name = n.trim(); saveState(); renderSubjectList(); } }
function deleteSubject(id) {
  const s = state.subjects[id]; if (!s) return;
  if (!confirm('删除科目「' + s.name + '」及其所有章节？')) return;
  s.chapterIds.forEach(cid => { delete state.chapters[cid]; });
  delete state.subjects[id];
  const keys = Object.keys(state.subjects);
  if (keys.length === 0) { const sid2 = 'subj_' + Date.now().toString(36); state.subjects[sid2] = { id: sid2, name: '默认科目', chapterIds: [] }; state.currentSubjectId = sid2; }
  else if (state.currentSubjectId === id) { state.currentSubjectId = keys[0]; state.currentChapterId = state.subjects[keys[0]].chapterIds[0] || null; }
  saveState(); renderSubjectList(); updateQuickActions();
}
function switchSubject(id) {
  if (!state.subjects[id]) return;
  state.currentSubjectId = id;
  const s = state.subjects[id];
  state.currentChapterId = s.chapterIds.length > 0 ? s.chapterIds[0] : null;
  saveState(); renderSubjectList(); updateQuickActions(); loadChapterStrategyToUI(); renderAiMaterialList(); updateAiMaterialCount();
  showSubjectDashboard(id);
}
// ===== 章节管理 =====
function createChapter(subjId, name) {
  const s = state.subjects[subjId]; if (!s) return null;
  const id = 'ch_' + Date.now().toString(36) + Math.random().toString(36).slice(2,4);
  state.chapters[id] = { id, name: name || ('章节 ' + (s.chapterIds.length + 1)), questions: [], userAnswers: [], currentIdx: 0, createdAt: Date.now(), strategy: { errPct: 60, reviewPct: 20, newPct: 20, typeCounts: { single: 10, judge: 5, term: 1, short: 1 }, weakTags: [] } };
  s.chapterIds.push(id); state.currentChapterId = id;
  saveState(); renderSubjectList(); updateQuickActions(); loadChapterStrategyToUI(); checkAchievements();
  return state.chapters[id];
}
function switchChapter(chId) { if (!state.chapters[chId]) return; state.currentChapterId = chId; saveState(); renderSubjectList(); updateQuickActions(); loadChapterStrategyToUI(); renderAiMaterialList(); updateAiMaterialCount(); showScreen('start'); }
function renameChapter(chId, newName) { const ch = state.chapters[chId]; if (!ch || !newName || !newName.trim()) return; ch.name = newName.trim(); saveState(); renderSubjectList(); }
function deleteChapter(chId) {
  if (!confirm('删除该章节？')) return;
  delete state.chapters[chId];
  for (const sid in state.subjects) { const s = state.subjects[sid]; const idx = s.chapterIds.indexOf(chId); if (idx !== -1) { s.chapterIds.splice(idx, 1); break; } }
  if (state.currentChapterId === chId) { const s = getSubj(); state.currentChapterId = (s && s.chapterIds.length > 0) ? s.chapterIds[0] : null; }
  saveState(); renderSubjectList(); updateQuickActions(); showScreen('start');
}
function renameChapterPrompt(chId) { const ch = state.chapters[chId]; if (!ch) return; const n = prompt('新名称：', ch.name); if (n && n.trim()) renameChapter(chId, n.trim()); }
// ===== 侧边栏渲染 =====
function renderSubjectList() {
  const container = document.getElementById('subject-list');
  if (!container) return;
  const sids = Object.keys(state.subjects);
  if (sids.length === 0) { container.innerHTML = '<div style="color:#666;text-align:center;padding:14px;font-size:13px;">暂无科目<br>点击上方「＋科目」</div>'; return; }
  let html = '';
  sids.forEach(sid => {
    const s = state.subjects[sid]; const active = sid === state.currentSubjectId ? 'active' : '';
    html += '<div class="subject-group"><div class="subject-header ' + active + '" onclick="switchSubject(\'' + sid + '\')">';
    html += '<span class="subj-name">📂 ' + escapeHtml(s.name) + '</span><span class="subj-count">' + s.chapterIds.length + '</span>';
    html += '<span class="subj-actions"><button class="subj-btn" onclick="event.stopPropagation();renameSubject(\'' + sid + '\')">✏️</button><button class="subj-btn sb-del" onclick="event.stopPropagation();deleteSubject(\'' + sid + '\')">🗑️</button></span></div>';
    html += '<div class="chapter-list-in-subj">';
    if (s.chapterIds.length > 0) {
      s.chapterIds.forEach(cid => {
        const ch = state.chapters[cid]; if (!ch) return;
        const ca = cid === state.currentChapterId ? 'active' : ''; const setCount = ch.quizSets ? ch.quizSets.length : 0;
        let totalAnswered = 0; let totalQuestions = 0;
        (ch.quizSets || []).forEach(set => { totalQuestions += set.questions.length; if (set.userAnswers) totalAnswered += set.userAnswers.filter(a => a !== undefined).length; });
        html += '<div class="chapter-item ' + ca + '" onclick="closeSidebarIfMobile();switchChapter(\'' + cid + '\')"><div class="chapter-info"><span class="chapter-name">' + escapeHtml(ch.name) + '</span><span class="chapter-count">' + totalAnswered + ' 题已答</span></div>';
        html += '<div class="ch-actions"><button class="ch-btn ch-hist" onclick="event.stopPropagation();showChapterHistory(\'' + cid + '\')">📜</button><button class="ch-btn" onclick="event.stopPropagation();renameChapterPrompt(\'' + cid + '\')">✏️</button><button class="ch-btn ch-del" onclick="event.stopPropagation();deleteChapter(\'' + cid + '\')">🗑️</button></div></div>';
      });
    }
    html += '<button class="btn-add-chapter" onclick="event.stopPropagation();createChapter(\'' + sid + '\')">＋ 新建章节</button></div></div>';
  });
  container.innerHTML = html;
}
