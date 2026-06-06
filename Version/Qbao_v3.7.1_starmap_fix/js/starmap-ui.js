// ===== Knowledge Star Map — UI Controller =====
// Tab activation, backend data fetching, bottom bar, detail panel, interaction events.

import * as THREE from 'three';

import {
  initStarmapScene, updateSceneBackground, starmapRenderNodes,
  resizeStarmap, stopRenderLoop, flyCameraTo, updateDotColors,
  getStarmapScene, getStarmapCamera, getStarmapControls, getStarmapRenderer,
  getChapterGroups, getTagGroups, getDotClouds, getLabelSprites, getNodeData, isSceneReady,
  updateAllConnectionLines, applySRSDimming
} from './starmap-render.js';

import {
  initForceSimulation, stopForceSimulation, springStep,
  applySpringPositions, resetSpringTargets, isForceActive,
  boostForceAlpha
} from './starmap-force.js';

// ---- Hover ring constants ----
const RING_RADIUS = 56; // px distance from center to each button

// ---- State ----
const sm = {
  data: null,
  snapshots: [],
  currentSnapshot: -1,
  heatmapMode: false,
  timelinePlaying: false,
  timelineTimer: null,
  bottomBarState: 'default',
  detailPanelVisible: false,
  detailPanelNode: null,
  hoveredNode: null,
  hoveredChapterNode: null,
  selectedNode: null,
  raycaster: null,
  mouse: null,
  animLoopId: null,
};

// ---- DOM references ----
let container, bottomBar, detailPanel, legend, heatmapLegend;

export async function starmapOnTabActivate(subjectId) {
  // Clean up previous instance if re-entering
  if (sm.animLoopId || isSceneReady()) {
    starmapOnTabDeactivate();
  }

  container = document.getElementById('starmap-container');
  if (!container) {
    container = buildStarmapDOM();
  }

  // Ensure container is visible
  container.style.display = 'block';

  // Init Three.js if not ready
  if (!isSceneReady()) {
    initStarmapScene(container);
  }

  // Show loading
  showLoading(true);

  // Fetch data
  try {
    const res = await fetchWithAuth('/starmap/' + subjectId);
    if (!res || !res.ok) {
      if (res && res.status === 304) {
        // Not modified, use cached data
      } else {
        showLoading(false);
        showEmpty('无法加载星图数据');
        return;
      }
    }
    const data = await res.json();
    sm.data = data;
    sm.snapshots = data.snapshots || [];
    sm.currentSnapshot = sm.snapshots.length - 1;

    // Render nodes in 3D scene
    starmapRenderNodes(data);

    // Start force simulation
    const chGroups = getChapterGroups();
    const tagGroups = getTagGroups();
    if (chGroups.length > 0 || Object.keys(tagGroups).length > 0) {
      initForceSimulation(chGroups, tagGroups, data.edges || []);
    }

    // Update UI
    updateBottomBarInfo(data);
    updateLegend(data);
  } catch (e) {
    console.error('starmap fetch error:', e);
    showLoading(false);
    showEmpty('加载出错: ' + e.message);
    return;
  }

  showLoading(false);

  // Setup interaction
  setupInteraction();

  // Start custom animation loop for spring + UI updates
  startUIAnimLoop();

  updateSceneBackground();
}

export function starmapOnTabDeactivate() {
  stopUIAnimLoop();
  stopRenderLoop();
  stopForceSimulation();
  sm.data = null;
  snapshotTargets = null;
  sm.heatmapMode = false;
  sm.hoveredNode = null;
  sm.hoveredChapterNode = null;
  if (sm.timelineTimer) {
    clearInterval(sm.timelineTimer);
    sm.timelineTimer = null;
  }
  if (container) container.style.display = 'none';
}

function buildStarmapDOM() {
  const screen = document.getElementById('screen-starmap');
  if (!screen) return null;

  // Create container
  const c = document.createElement('div');
  c.id = 'starmap-container';
  c.style.display = 'block';

  // Legend
  const leg = document.createElement('div');
  leg.className = 'starmap-legend';
  leg.id = 'starmap-legend';
  leg.innerHTML = `
    <div class="legend-item"><span class="legend-dot chapter"></span> 章节</div>
    <div class="legend-item"><span class="legend-dot tag"></span> 知识点</div>
    <div class="legend-item"><span class="legend-dot correct"></span> 正确题</div>
    <div class="legend-item"><span class="legend-dot wrong"></span> 错题</div>
  `;
  c.appendChild(leg);
  legend = leg;

  // Heatmap legend
  const hLeg = document.createElement('div');
  hLeg.className = 'starmap-heatmap-legend';
  hLeg.id = 'starmap-heatmap-legend';
  hLeg.innerHTML = `
    <span style="font-size:10px;">掌握度</span>
    <div class="gradient-bar"></div>
    <div class="gradient-labels"><span>高</span><span>中</span><span>低</span></div>
  `;
  c.appendChild(hLeg);
  heatmapLegend = hLeg;

  // Detail panel
  const dp = document.createElement('div');
  dp.className = 'starmap-detail-panel';
  dp.id = 'starmap-detail-panel';
  dp.innerHTML = `
    <div class="panel-header">
      <span id="starmap-panel-title">节点详情</span>
      <button class="close-btn" id="starmap-panel-close">✕</button>
    </div>
    <div class="panel-body" id="starmap-panel-body"></div>
  `;
  c.appendChild(dp);
  detailPanel = dp;

  // Bottom bar
  const bb = document.createElement('div');
  bb.className = 'starmap-bottom-bar state-default';
  bb.id = 'starmap-bottom-bar';
  bb.innerHTML = `
    <div class="bar-row">
      <button class="bar-btn" data-action="back">← 返回</button>
      <button class="bar-btn" data-action="timeline">⏱ 时间穿梭</button>
      <div class="bar-spacer"></div>
      <button class="bar-btn" data-action="exam">📝 大考卷</button>
      <button class="bar-btn" data-action="srs">📅 间隔复习</button>
      <div class="bar-divider"></div>
      <button class="bar-btn icon-only" data-action="heatmap">🔥</button>
      <button class="bar-btn icon-only" data-action="reset-camera">🔄</button>
      <span class="bar-info" id="starmap-bar-info"></span>
    </div>
    <div class="timeline-row">
      <button class="timeline-play" id="starmap-timeline-play">▶</button>
      <input type="range" class="timeline-slider" id="starmap-timeline-slider" min="0" max="0" value="0">
      <span class="timeline-date" id="starmap-timeline-date"></span>
      <div class="bar-divider" style="margin:0 4px;"></div>
      <div class="mini-chart" id="starmap-mini-chart"></div>
    </div>
    <div class="operation-row" id="starmap-op-row">
      <div class="op-chapter-chips" id="starmap-op-chips"></div>
      <div class="op-config-row">
        <span id="starmap-op-summary"></span>
        <button class="op-generate-btn" id="starmap-op-generate">生成试卷 →</button>
      </div>
    </div>
  `;
  c.appendChild(bb);
  bottomBar = bb;

  // Loading overlay
  const loading = document.createElement('div');
  loading.className = 'starmap-loading';
  loading.id = 'starmap-loading';
  loading.textContent = '正在加载星图...';
  loading.style.display = 'none';
  c.appendChild(loading);

  // Hover ring (chapter action buttons)
  const ring = document.createElement('div');
  ring.className = 'starmap-hover-ring';
  ring.id = 'starmap-hover-ring';
  ring.innerHTML = `
    <button class="ring-btn up" data-ring-action="focus">   <span class="ring-label">章节</span></button>
    <button class="ring-btn right" data-ring-action="qbank"> <span class="ring-label">题库</span></button>
    <button class="ring-btn down" data-ring-action="exam">  <span class="ring-label">组卷</span></button>
    <button class="ring-btn left" data-ring-action="srs">   <span class="ring-label">复习</span></button>
  `;
  ring.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ring-action]');
    if (!btn || !sm.hoveredChapterNode) return;
    const action = btn.dataset.ringAction;
    const chId = sm.hoveredChapterNode.userData.id;
    handleRingAction(action, chId);
  });
  c.appendChild(ring);

  // Setup dark mode observer for scene background
  setupDarkModeObserver();

  // Insert into the starmap screen
  screen.appendChild(c);

  // Attach bottom bar events
  attachBarEvents();

  // Attach detail panel close
  document.getElementById('starmap-panel-close').addEventListener('click', closeDetailPanel);

  return c;
}

function attachBarEvents() {
  if (!bottomBar) return;
  bottomBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    switch (action) {
      case 'back':
        starmapOnTabDeactivate();
        showScreen('start');
        break;
      case 'timeline':
        toggleTimeline();
        break;
      case 'exam':
        openOperationPanel('exam');
        break;
      case 'srs':
        openOperationPanel('srs');
        break;
      case 'heatmap':
        toggleHeatmap();
        break;
      case 'reset-camera':
        resetCamera();
        break;
    }
  });

  // Timeline slider
  const slider = document.getElementById('starmap-timeline-slider');
  if (slider) {
    slider.addEventListener('input', () => {
      const idx = parseInt(slider.value);
      applySnapshot(idx);
    });
  }

  // Play button
  const playBtn = document.getElementById('starmap-timeline-play');
  if (playBtn) {
    playBtn.addEventListener('click', toggleTimelinePlay);
  }

  // Generate button
  const genBtn = document.getElementById('starmap-op-generate');
  if (genBtn) {
    genBtn.addEventListener('click', () => generateFromOpPanel());
  }
}

// ---- Bottom bar state management ----

function toggleTimeline() {
  if (sm.bottomBarState === 'timeline') {
    setBottomBarState('default');
  } else {
    setBottomBarState('timeline');
    updateTimelineUI();
  }
}

function setBottomBarState(state) {
  sm.bottomBarState = state;
  if (!bottomBar) return;
  bottomBar.classList.remove('state-default', 'state-timeline', 'state-operation');
  bottomBar.classList.add('state-' + state);
}

function updateBottomBarInfo(data) {
  const info = document.getElementById('starmap-bar-info');
  if (!info) return;
  const d = data || sm.data;
  if (!d) return;
  info.textContent = `${d.nodeCount || 0} 知识点 · ${d.questionCount || 0} 题`;
}

function updateLegend(data) {
  const d = data || sm.data;
  if (!d || !legend) return;
  const totalTags = (d.tags || []).length;
  const totalQ = d.questionCount || 0;
  const existingInfo = legend.querySelector('.legend-summary');
  if (existingInfo) existingInfo.remove();
  const summary = document.createElement('div');
  summary.className = 'legend-summary';
  summary.style.cssText = 'margin-top:6px;font-size:10px;color:var(--text-muted);';
  summary.textContent = `${d.chapters.length} 章节 · ${totalTags} 知识点 · ${totalQ} 题`;
  legend.appendChild(summary);
}

// ---- Timeline ----

function updateTimelineUI() {
  const snapshots = sm.snapshots;
  if (!snapshots || snapshots.length === 0) return;

  const slider = document.getElementById('starmap-timeline-slider');
  if (slider) {
    slider.max = snapshots.length - 1;
    slider.value = sm.currentSnapshot >= 0 ? sm.currentSnapshot : snapshots.length - 1;
  }

  const dateEl = document.getElementById('starmap-timeline-date');
  if (dateEl && sm.currentSnapshot >= 0) {
    dateEl.textContent = snapshots[sm.currentSnapshot].date || '';
  }

  // Mini chart
  const chart = document.getElementById('starmap-mini-chart');
  if (chart) {
    const maxQ = Math.max(...snapshots.map(s => {
      let total = 0;
      for (const k in s.tagStats) total += s.tagStats[k].totalQ;
      return total;
    }), 1);
    chart.innerHTML = snapshots.map(s => {
      let total = 0;
      for (const k in s.tagStats) total += s.tagStats[k].totalQ;
      const h = Math.max(3, (total / maxQ) * 18);
      return `<div class="mini-bar" style="height:${h}px;background:${s === snapshots[snapshots.length-1] ? 'var(--color-primary)' : 'var(--border-default)'};" title="${s.date}"></div>`;
    }).join('');
  }
}

function toggleTimelinePlay() {
  if (sm.timelinePlaying) {
    stopTimelinePlay();
    return;
  }
  sm.timelinePlaying = true;
  const playBtn = document.getElementById('starmap-timeline-play');
  if (playBtn) playBtn.textContent = '⏸';
  sm.currentSnapshot = 0;

  sm.timelineTimer = setInterval(() => {
    if (sm.currentSnapshot >= sm.snapshots.length - 1) {
      stopTimelinePlay();
      return;
    }
    sm.currentSnapshot++;
    const slider = document.getElementById('starmap-timeline-slider');
    if (slider) slider.value = sm.currentSnapshot;
    applySnapshot(sm.currentSnapshot);
  }, 1500); // 1.5s per frame
}

function stopTimelinePlay() {
  sm.timelinePlaying = false;
  if (sm.timelineTimer) {
    clearInterval(sm.timelineTimer);
    sm.timelineTimer = null;
  }
  const playBtn = document.getElementById('starmap-timeline-play');
  if (playBtn) playBtn.textContent = '▶';
}

// Snapshot interpolation targets (applied incrementally in anim loop)
let snapshotTargets = null; // { tagId: { targetScale, targetColor, dotAlphaMap: { questionId: alpha } } }

function applySnapshot(idx) {
  sm.currentSnapshot = idx;
  const snap = sm.snapshots[idx];
  if (!snap) return;

  const tagGroups = getTagGroups();
  const tags = sm.data ? sm.data.tags : [];
  const questions = sm.data ? sm.data.questions : [];

  // Build chapterId→tags map for chapter stat updates
  const chapterTagMap = {};
  tags.forEach(t => {
    if (!chapterTagMap[t.chapterId]) chapterTagMap[t.chapterId] = [];
    chapterTagMap[t.chapterId].push(t.id);
  });

  // Compute per-tag cumulative stats from snapshot
  snapshotTargets = {};

  Object.values(tagGroups).forEach(g => {
    const tagData = g.userData && g.userData.data;
    if (!tagData) return;
    const tagId = tagData.id;
    const snapStat = snap.tagStats && snap.tagStats[tagId];

    const targetScale = snapStat
      ? 0.3 + Math.min(snapStat.totalQ / 30, 0.5)
      : 0.2;

    const targetAcc = snapStat && snapStat.totalQ > 0
      ? snapStat.correct / snapStat.totalQ
      : 0;

    // Dot visibility: questions with lastReviewTime <= snapshot date are visible
    const snapDateMs = snap.date ? new Date(snap.date).getTime() : 0;
    const tagQs = questions.filter(q => q.tagId === tagId);
    const dotAlphaMap = {};
    tagQs.forEach((q, i) => {
      const reviewTime = q.lastReviewTime || 0;
      // Dot is visible if reviewed on or before this snapshot, OR if no snap date (show all)
      const visible = snapDateMs === 0 || reviewTime <= snapDateMs;
      dotAlphaMap[i] = visible ? 1.0 : 0.0;
    });

    snapshotTargets[tagId] = {
      targetScale,
      targetAcc,
      dotAlphaMap,
      snapStat,
    };
  });

  // Update chapter groups scale (smooth via anim loop)
  const chGroups = getChapterGroups();
  chGroups.forEach(g => {
    const chData = g.userData && g.userData.data;
    if (!chData) return;
    // Compute chapter accuracy at this snapshot from its tags
    let chTotal = 0, chCorrect = 0;
    const chTagIds = chapterTagMap[chData.id] || [];
    for (const tid of chTagIds) {
      const ss = snap.tagStats && snap.tagStats[tid];
      if (ss) {
        chTotal += ss.totalQ || 0;
        chCorrect += ss.correct || 0;
      }
    }
    if (!g.userData._snapTargets) g.userData._snapTargets = {};
    g.userData._snapTargets.scale = 1.0 + Math.min(chTotal / 100, 0.8);
    g.userData._snapTargets.accuracy = chTotal > 0 ? chCorrect / chTotal : 0;
  });

  // If at latest snapshot, clear targets so SRS dimming takes over
  if (idx >= sm.snapshots.length - 1) {
    snapshotTargets = null;
    // Reset chapter snapshot targets too
    const chGroups = getChapterGroups();
    chGroups.forEach(g => {
      if (g.userData._snapTargets) delete g.userData._snapTargets;
    });
  }

  const dateEl = document.getElementById('starmap-timeline-date');
  if (dateEl) dateEl.textContent = snap.date || '';
}

// ---- Operation panel ----

let currentOpType = null;

function openOperationPanel(type) {
  if (sm.bottomBarState === 'operation' && currentOpType === type) {
    setBottomBarState('default');
    currentOpType = null;
    return;
  }
  currentOpType = type;
  setBottomBarState('operation');

  const chipsContainer = document.getElementById('starmap-op-chips');
  const summary = document.getElementById('starmap-op-summary');
  const genBtn = document.getElementById('starmap-op-generate');

  if (!sm.data || !sm.data.chapters) return;

  // Chapter chips
  if (chipsContainer) {
    chipsContainer.innerHTML = sm.data.chapters.map(ch =>
      `<span class="op-chapter-chip selected" data-chapter-id="${ch.id}">✓ ${ch.name}</span>`
    ).join('');
    chipsContainer.querySelectorAll('.op-chapter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('selected');
        updateOpSummary();
      });
    });
  }

  if (genBtn) {
    genBtn.textContent = type === 'exam' ? '生成试卷 →' : '开始复习 →';
  }

  updateOpSummary();
}

function updateOpSummary() {
  const summary = document.getElementById('starmap-op-summary');
  if (!summary) return;
  const selectedChips = document.querySelectorAll('.op-chapter-chip.selected');
  const count = selectedChips.length;
  summary.textContent = `已选 ${count} 个章节`;
}

function generateFromOpPanel() {
  const selectedChips = document.querySelectorAll('.op-chapter-chip.selected');
  const chapterIds = Array.from(selectedChips).map(c => c.dataset.chapterId);

  if (chapterIds.length === 0) {
    alert('请至少选择一个章节');
    return;
  }

  if (currentOpType === 'exam') {
    // Dispatch to exam composer
    if (typeof window.renderSubjComposeExam === 'function') {
      setBottomBarState('default');
      sm.bottomBarState = 'default';
      // This opens the existing compose exam UI prepopulated
      window.generateExamForChapters(chapterIds);
    }
  } else if (currentOpType === 'srs') {
    if (typeof window.startSrsForChapters === 'function') {
      setBottomBarState('default');
      sm.bottomBarState = 'default';
      window.startSrsForChapters(chapterIds);
    }
  }
}

// ---- Heatmap ----

function toggleHeatmap() {
  sm.heatmapMode = !sm.heatmapMode;
  const btn = bottomBar.querySelector('[data-action="heatmap"]');
  if (btn) {
    btn.classList.toggle('active', sm.heatmapMode);
  }
  heatmapLegend.classList.toggle('visible', sm.heatmapMode);

  const tagGroups = getTagGroups();
  const dotClouds = getDotClouds();

  Object.values(tagGroups).forEach(g => {
    const tagData = g.userData && g.userData.data;
    if (!tagData) return;
    const sphere = g.children[0];
    if (!sphere || !sphere.material) return;

    if (sm.heatmapMode) {
      const acc = tagData.accuracy || 0;
      const hColor = accuracyToHeatColor(acc);
      sphere.material.color.set(hColor);
      sphere.material.emissive.set(hColor);
      sphere.material.emissiveIntensity = 0.5;
    } else {
      const cat = tagData.category;
      sphere.material.color.set(tagColorForCat(cat));
      sphere.material.emissive.set(tagColorForCat(cat));
      sphere.material.emissiveIntensity = 0.2;
    }
  });

  // Recolor question dots for heatmap
  const tagAccMap = {};
  (sm.data && sm.data.tags || []).forEach(t => { tagAccMap[t.id] = t.accuracy || 0; });

  Object.entries(dotClouds).forEach(([tagId, clouds]) => {
    const acc = tagAccMap[tagId] !== undefined ? tagAccMap[tagId] : 0.5;
    clouds.forEach(points => {
      const colorAttr = points.geometry.attributes.aColor;
      if (!colorAttr) return;
      const qData = points.userData.questionData;
      if (!qData) return;

      if (!points.userData._origColors) {
        points.userData._origColors = new Float32Array(colorAttr.count * 3);
        for (let i = 0; i < colorAttr.count * 3; i++) {
          points.userData._origColors[i] = colorAttr.array[i];
        }
      }

      if (sm.heatmapMode) {
        const heatColor = accuracyToHeatColor(acc);
        // Slightly vary each dot's color around the heatmap color for organic feel
        for (let i = 0; i < colorAttr.count; i++) {
          const variation = 0.85 + Math.random() * 0.3;
          colorAttr.setXYZ(i,
            Math.min(1, heatColor.r * variation),
            Math.min(1, heatColor.g * variation),
            Math.min(1, heatColor.b * variation)
          );
        }
      } else {
        // Restore original colors
        const orig = points.userData._origColors;
        for (let i = 0; i < colorAttr.count; i++) {
          colorAttr.setXYZ(i, orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]);
        }
      }
      colorAttr.needsUpdate = true;
    });
  });

  // Lock camera rotation in heatmap mode (2D data projection)
  const controls = getStarmapControls();
  if (controls) {
    controls.enableRotate = !sm.heatmapMode;
  }
}

function accuracyToHeatColor(accuracy) {
  // Stepped mapping for clear visual distinction:
  // 0-25% → bright red, 25-50% → orange, 50-75% → yellow-green, 75-100% → bright green
  if (accuracy < 0.25) {
    const t = accuracy / 0.25;
    return new THREE.Color(1.0, 0.05 + t * 0.3, 0.05);
  } else if (accuracy < 0.50) {
    const t = (accuracy - 0.25) / 0.25;
    return new THREE.Color(1.0, 0.3 + t * 0.5, 0.0);
  } else if (accuracy < 0.75) {
    const t = (accuracy - 0.50) / 0.25;
    return new THREE.Color(1.0 - t * 0.5, 0.8 + t * 0.2, 0.0);
  } else {
    const t = (accuracy - 0.75) / 0.25;
    return new THREE.Color(0.1, 0.8 + t * 0.2, 0.1 + t * 0.3);
  }
}

function tagColorForCat(cat) {
  switch (cat) {
    case 'error': return 0xffcccc;
    case 'review': return 0xccddff;
    default: return 0xe8e8f0;
  }
}

// ---- Detail panel ----

function openDetailPanel(node, type) {
  const panel = document.getElementById('starmap-detail-panel');
  if (!panel) return;
  panel.classList.add('visible');
  sm.detailPanelVisible = true;
  sm.detailPanelNode = node;

  let title, body;
  if (type === 'chapter') {
    title = node.userData.name || '章节';
    body = renderChapterDetail(node.userData.data);
  } else {
    title = node.userData.label || node.userData.id;
    body = renderTagDetail(node.userData.data);
  }

  document.getElementById('starmap-panel-title').textContent = title;
  document.getElementById('starmap-panel-body').innerHTML = body;
}

function closeDetailPanel() {
  const panel = document.getElementById('starmap-detail-panel');
  if (panel) panel.classList.remove('visible');
  sm.detailPanelVisible = false;
  sm.detailPanelNode = null;
}

/** Open the detail panel showing all questions for a chapter (qbank action) */
function openChapterQuestionList(chapterId) {
  const chData = sm.data && sm.data.chapters && sm.data.chapters.find(c => c.id === chapterId);
  if (!chData) return;

  const panel = document.getElementById('starmap-detail-panel');
  if (!panel) return;
  panel.classList.add('visible');
  sm.detailPanelVisible = true;

  document.getElementById('starmap-panel-title').textContent = '📚 ' + (chData.name || chapterId);

  const chQs = (sm.data.questions || []).filter(q => q.chapterId === chapterId);
  let body = `<div class="panel-stats">
    <div class="panel-stat"><div class="stat-num">${chData.totalQ || 0}</div><div class="stat-label">总题数</div></div>
    <div class="panel-stat"><div class="stat-num">${Math.round((chData.accuracy || 0) * 100)}%</div><div class="stat-label">正确率</div></div>
  </div>`;
  body += '<div class="question-mini-list"><h5>题目列表 (' + chQs.length + ')</h5>';

  // Group questions by tag
  const byTag = {};
  chQs.forEach(q => {
    const t = q.tagId || '未分类';
    if (!byTag[t]) byTag[t] = [];
    byTag[t].push(q);
  });

  for (const [tagName, qs] of Object.entries(byTag)) {
    body += `<div style="margin-bottom:8px;"><span class="tag-chip" style="font-size:10px;margin-bottom:4px;">${tagName} (${qs.length})</span>`;
    qs.slice(0, 30).forEach(q => {
      const status = q.isCorrect ? 'correct' : (q.isWrong ? 'wrong' : 'unanswered');
      const icon = q.isCorrect ? '✓' : (q.isWrong ? '✗' : '○');
      body += `<div class="question-mini ${status}"><span class="q-dot"></span>${icon} ${q.question || '(无题目文本)'}</div>`;
    });
    if (qs.length > 30) body += `<p style="font-size:10px;color:var(--text-muted);">...还有 ${qs.length - 30} 题</p>`;
    body += '</div>';
  }
  body += '</div>';

  document.getElementById('starmap-panel-body').innerHTML = body;
}

function renderChapterDetail(ch) {
  if (!ch) return '<p class="empty-state">无数据</p>';
  return `
    <div class="panel-stats">
      <div class="panel-stat"><div class="stat-num">${ch.totalQ || 0}</div><div class="stat-label">总题数</div></div>
      <div class="panel-stat"><div class="stat-num">${Math.round((ch.accuracy || 0) * 100)}%</div><div class="stat-label">正确率</div></div>
      <div class="panel-stat"><div class="stat-num">${ch.correct || 0}</div><div class="stat-label">正确</div></div>
      <div class="panel-stat"><div class="stat-num">${(ch.totalQ || 0) - (ch.correct || 0)}</div><div class="stat-label">错题</div></div>
    </div>
    <div class="panel-tags">
      <h5>知识点标签</h5>
      <div class="tag-chips" id="starmap-panel-tags"></div>
    </div>
    <div class="panel-actions">
      <button class="btn primary" onclick="window.switchChapter('${ch.id}')">▶ 跳转到该章节</button>
      <button class="btn" onclick="window.openQBankForChapter('${ch.id}')">📚 浏览题库</button>
    </div>
  `;
}

function renderTagDetail(tag) {
  if (!tag) return '<p class="empty-state">无数据</p>';
  const acc = Math.round((tag.accuracy || 0) * 100);
  const correctPct = tag.totalQ > 0 ? Math.round((tag.correct || 0) / tag.totalQ * 100) : 0;
  return `
    <div class="panel-stats">
      <div class="panel-stat"><div class="stat-num">${tag.totalQ || 0}</div><div class="stat-label">题目数</div></div>
      <div class="panel-stat"><div class="stat-num">${acc}%</div><div class="stat-label">正确率</div></div>
    </div>
    <div class="tag-accuracy-bar">
      <div class="correct-seg" style="width:${correctPct}%"></div>
      <div class="wrong-seg" style="width:${100 - correctPct}%"></div>
    </div>
    <div style="font-size:var(--fs-xs);color:var(--text-muted);margin-bottom:12px;">
      所属章节：${tag.chapterId || '-'}<br>
      分类：${tag.category === 'error' ? '🔴 薄弱' : tag.category === 'review' ? '🟡 已掌握' : '⚪ 未答题'}<br>
      最近答题：${tag.lastAnswer ? new Date(tag.lastAnswer).toLocaleDateString() : '从未'}
    </div>
    <div class="panel-actions">
      <button class="btn primary" onclick="window.focusTagQuestions('${tag.id}')">📝 专攻此知识点</button>
      <button class="btn" onclick="window.viewTagQuestions('${tag.id}')">📋 查看关联题目</button>
    </div>
  `;
}

// ---- Interaction ----

function setupInteraction() {
  const renderer = getStarmapRenderer();
  const camera = getStarmapCamera();

  if (!sm.raycaster) {
    sm.raycaster = new THREE.Raycaster();
    sm.raycaster.params.Points.threshold = 0.5;
  }
  sm.mouse = new THREE.Vector2();

  const canvas = renderer.domElement;

  // Click handler
  canvas.addEventListener('click', onCanvasClick);

  // Mouse move for hover
  canvas.addEventListener('mousemove', throttle(onCanvasMouseMove, 50));

  // Double-click to reset camera
  canvas.addEventListener('dblclick', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const my = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    sm.mouse.set(mx, my);
    sm.raycaster.setFromCamera(sm.mouse, camera);

    const interactables = getInteractables();
    const hits = sm.raycaster.intersectObjects(interactables, true);
    if (hits.length === 0) {
      resetCamera();
      closeDetailPanel();
    }
  });

  // Touch support
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = canvas.getBoundingClientRect();
      sm.mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      sm.mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
      sm.raycaster.setFromCamera(sm.mouse, camera);
      const interactables = getInteractables();
      const hits = sm.raycaster.intersectObjects(interactables, true);
      if (hits.length > 0) {
        handleNodeClick(hits[0].object);
      }
    }
  });
}

function getInteractables() {
  const objects = [];
  const chGroups = getChapterGroups();
  const tagGroups = getTagGroups();

  chGroups.forEach(g => {
    g.traverse(c => { if (c.isMesh || c.isPoints) objects.push(c); });
  });
  Object.values(tagGroups).forEach(g => {
    g.traverse(c => { if (c.isMesh || c.isPoints) objects.push(c); });
  });

  return objects;
}

function onCanvasClick(e) {
  const canvas = getStarmapRenderer().domElement;
  const camera = getStarmapCamera();
  const rect = canvas.getBoundingClientRect();
  sm.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  sm.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  sm.raycaster.setFromCamera(sm.mouse, camera);

  const interactables = getInteractables();
  const hits = sm.raycaster.intersectObjects(interactables, true);

  if (hits.length > 0) {
    const obj = hits[0].object;
    handleNodeClick(obj);
  } else {
    closeDetailPanel();
  }
}

function onCanvasMouseMove(e) {
  const canvas = getStarmapRenderer().domElement;
  const camera = getStarmapCamera();
  const rect = canvas.getBoundingClientRect();
  sm.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  sm.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  sm.raycaster.setFromCamera(sm.mouse, camera);

  const interactables = getInteractables();
  const hits = sm.raycaster.intersectObjects(interactables, true);

  if (hits.length > 0) {
    const obj = hits[0].object;
    // Walk up to find userData node
    let node = obj;
    while (node && (!node.userData || !node.userData.type)) { node = node.parent; }

    if (sm.hoveredNode !== obj) {
      resetHover();
      sm.hoveredNode = obj;
      applyHover(obj);
      canvas.style.cursor = 'pointer';

      // Chapter hover → show action ring
      if (node && node.userData && node.userData.type === 'chapter') {
        sm.hoveredChapterNode = node;
        positionHoverRing(node, rect);
        showHoverRing(true);
        applyHoverPerturbation(node);
      } else if (node && node.userData && node.userData.type === 'tag') {
        sm.hoveredChapterNode = null;
        showHoverRing(false);
        applyHoverPerturbation(node);
      }
    }

    // Update ring position on move (only if chapter is hovered)
    if (sm.hoveredChapterNode) {
      positionHoverRing(sm.hoveredChapterNode, rect);
    }
  } else {
    resetHover();
    sm.hoveredNode = null;
    sm.hoveredChapterNode = null;
    showHoverRing(false);
    canvas.style.cursor = 'grab';
  }
}

function handleNodeClick(obj) {
  let node = obj;
  // Walk up to find the group with userData
  while (node && (!node.userData || !node.userData.type)) {
    node = node.parent;
  }
  if (!node || !node.userData) return;

  const type = node.userData.type;
  if (type === 'chapter') {
    openDetailPanel(node, 'chapter');
    // Populate tag chips in panel
    setTimeout(() => populatePanelTags(node.userData.id), 100);
  } else if (type === 'tag') {
    openDetailPanel(node, 'tag');
  }

  // Fly camera to node
  const target = node.position.clone();
  const lookTarget = target.clone().add(new THREE.Vector3(0, 0, 4));
  flyCameraTo(target, lookTarget, 0.8);
}

function populatePanelTags(chapterId) {
  const container = document.getElementById('starmap-panel-tags');
  if (!container || !sm.data) return;
  const chTags = (sm.data.tags || []).filter(t => t.chapterId === chapterId);
  container.innerHTML = chTags.map(t =>
    `<span class="tag-chip cat-${t.category}" onclick="window.clickPanelTag('${t.id}')">${t.label || t.id}</span>`
  ).join('');
}

function applyHover(obj) {
  if (obj.material) {
    if (obj.material.emissive) {
      obj.userData._prevEmissive = obj.material.emissive.getHex();
      obj.userData._prevEmissiveIntensity = obj.material.emissiveIntensity;
      obj.material.emissive.set(0xffffff);
      obj.material.emissiveIntensity = 0.6;
    } else if (obj.material.color) {
      obj.userData._prevColor = obj.material.color.getHex();
      obj.material.color.multiplyScalar(1.4);
    }
  }
  if (obj.scale) {
    obj.userData._prevScale = obj.scale.clone();
    obj.scale.multiplyScalar(1.15);
  }
}

function resetHover() {
  if (!sm.hoveredNode) return;
  const obj = sm.hoveredNode;
  if (obj.material) {
    if (obj.userData._prevEmissive !== undefined && obj.material.emissive) {
      obj.material.emissive.set(obj.userData._prevEmissive);
      obj.material.emissiveIntensity = obj.userData._prevEmissiveIntensity || 0;
      delete obj.userData._prevEmissive;
      delete obj.userData._prevEmissiveIntensity;
    } else if (obj.userData._prevColor !== undefined && obj.material.color) {
      obj.material.color.set(obj.userData._prevColor);
      delete obj.userData._prevColor;
    }
  }
  if (obj.userData._prevScale && obj.scale) {
    obj.scale.copy(obj.userData._prevScale);
    delete obj.userData._prevScale;
  }
}

// ---- Hover ring positioning ----

function positionHoverRing(chapterGroup, canvasRect) {
  const ring = document.getElementById('starmap-hover-ring');
  if (!ring) return;

  const camera = getStarmapCamera();
  const worldPos = chapterGroup.position.clone();
  // Offset upward to not cover the sphere
  worldPos.y += chapterGroup.children[0] ? chapterGroup.children[0].scale.x * 1.6 : 1.6;

  const screenPos = worldPos.clone().project(camera);
  const x = (screenPos.x * 0.5 + 0.5) * canvasRect.width + canvasRect.left;
  const y = (-screenPos.y * 0.5 + 0.5) * canvasRect.height + canvasRect.top;

  // Check if behind camera
  if (screenPos.z > 1) {
    showHoverRing(false);
    return;
  }

  ring.style.left = x + 'px';
  ring.style.top = y + 'px';

  // Position ring buttons in cross layout
  const upBtn = ring.querySelector('.ring-btn.up');
  const rightBtn = ring.querySelector('.ring-btn.right');
  const downBtn = ring.querySelector('.ring-btn.down');
  const leftBtn = ring.querySelector('.ring-btn.left');
  if (upBtn)    upBtn.style.cssText = 'position:absolute;left:0;top:' + (-RING_RADIUS) + 'px;transform:translate(-50%,-50%);';
  if (rightBtn) rightBtn.style.cssText = 'position:absolute;left:' + RING_RADIUS + 'px;top:0;transform:translate(-50%,-50%);';
  if (downBtn)  downBtn.style.cssText = 'position:absolute;left:0;top:' + RING_RADIUS + 'px;transform:translate(-50%,-50%);';
  if (leftBtn)  leftBtn.style.cssText = 'position:absolute;left:' + (-RING_RADIUS) + 'px;top:0;transform:translate(-50%,-50%);';
}

function showHoverRing(visible) {
  const ring = document.getElementById('starmap-hover-ring');
  if (!ring) return;
  if (visible) {
    ring.classList.add('visible');
  } else {
    ring.classList.remove('visible');
  }
}

function handleRingAction(action, chapterId) {
  showHoverRing(false);
  sm.hoveredChapterNode = null;

  switch (action) {
    case 'focus':
      // Camera already focused via hover; open detail panel
      if (typeof openDetailPanel === 'function' && sm.hoveredNode) {
        let node = sm.hoveredNode;
        while (node && (!node.userData || !node.userData.type)) { node = node.parent; }
        if (node) openDetailPanel(node, 'chapter');
      }
      break;
    case 'qbank':
      // Open chapter question list in the detail panel
      if (typeof _origSwitchChapter === 'function') _origSwitchChapter(chapterId);
      setTimeout(() => {
        openChapterQuestionList(chapterId);
      }, 400);
      break;
    case 'exam':
      if (typeof openOperationPanel === 'function') {
        openOperationPanel('exam');
        // Deselect all except the hovered chapter
        setTimeout(() => {
          document.querySelectorAll('.op-chapter-chip').forEach(c => {
            c.classList.toggle('selected', c.dataset.chapterId === chapterId);
          });
          updateOpSummary();
        }, 50);
      }
      break;
    case 'srs':
      if (typeof openOperationPanel === 'function') {
        openOperationPanel('srs');
        setTimeout(() => {
          document.querySelectorAll('.op-chapter-chip').forEach(c => {
            c.classList.toggle('selected', c.dataset.chapterId === chapterId);
          });
          updateOpSummary();
        }, 50);
      }
      break;
  }
}

// ---- Hover spring perturbation ----

function applyHoverPerturbation(nodeGroup) {
  if (typeof window.getSpringState !== 'function') return;
  const springState = window.getSpringState(nodeGroup.uuid);
  if (!springState) return;

  // Small random nudge to spring target for organic bounce
  springState.target.x += (Math.random() - 0.5) * 0.6;
  springState.target.y += (Math.random() - 0.5) * 0.4;
  springState.target.z += (Math.random() - 0.5) * 0.6;

  // Boost force simulation for visible ripple effect
  boostForceAlpha(0.3);
}

// ---- Dark mode observer ----

function setupDarkModeObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === 'class') {
        updateSceneBackground();
        break;
      }
    }
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

// ---- Utility ----

function resetCamera() {
  const camera = getStarmapCamera();
  const controls = getStarmapControls();
  camera.position.set(0, 8, 30);
  controls.target.set(0, 0, 0);
  controls.update();
}

function showLoading(on) {
  const el = document.getElementById('starmap-loading');
  if (el) el.style.display = on ? 'block' : 'none';
}

function showEmpty(msg) {
  const el = document.getElementById('starmap-loading');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function throttle(fn, ms) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn.apply(this, args); }
  };
}

// ---- Animation loop (spring + line updates + SRS dimming) ----

let srsDimCounter = 0;

function startUIAnimLoop() {
  let lastTime = performance.now() / 1000;

  function loop() {
    sm.animLoopId = requestAnimationFrame(loop);

    // Auto-cleanup if screen is no longer active
    const screen = document.getElementById('screen-starmap');
    if (!screen || !screen.classList.contains('active')) {
      starmapOnTabDeactivate();
      return;
    }

    const now = performance.now() / 1000;
    const dt = now - lastTime;
    lastTime = now;

    // Apply spring physics
    springStep(dt);
    const chGroups = getChapterGroups();
    const tagGroups = getTagGroups();
    applySpringPositions(chGroups, tagGroups);

    // Update all connection lines dynamically
    updateAllConnectionLines(chGroups, tagGroups);

    // Sprite smooth distance scaling: proportional shrink + fade with distance
    const sprites = getLabelSprites();
    if (sprites.length > 0) {
      const cam = getStarmapCamera();
      sprites.forEach(s => {
        if (!s.parent) return;
        const worldPos = new THREE.Vector3();
        s.parent.getWorldPosition(worldPos);
        const dist = cam.position.distanceTo(worldPos);
        // Smooth visibility: full at 10, zero at 40
        const visibility = 1.0 - Math.max(0, Math.min(1, (dist - 10) / 30));
        s.visible = visibility > 0.02;
        s.material.opacity = visibility;
        // Proportional scale shrink
        const scl = 0.5 + visibility * 0.5;
        const baseX = s.userData._baseScaleX || s.scale.x;
        const baseY = s.userData._baseScaleY || 1.0;
        s.scale.set(baseX * scl, baseY * scl, 1);
      });
    }

    // Update hover ring position if visible (node may be moving)
    if (sm.hoveredChapterNode) {
      const canvas = getStarmapRenderer().domElement;
      const rect = canvas.getBoundingClientRect();
      positionHoverRing(sm.hoveredChapterNode, rect);
    }

    // Snapshot interpolation (smooth transition toward time-travel targets)
    if (snapshotTargets) {
      const lerpFactor = 0.12;
      Object.entries(tagGroups).forEach(([tagId, g]) => {
        const tgt = snapshotTargets[tagId];
        if (!tgt) return;

        // Interpolate tag sphere scale
        const sphere = g.children[0];
        if (sphere && sphere.scale) {
          const s = tgt.targetScale;
          sphere.scale.lerp(new THREE.Vector3(s, s, s), lerpFactor);
        }

        // Interpolate tag sphere color toward accuracy-based color
        if (sphere && sphere.material && sphere.material.color && !sm.heatmapMode) {
          const acc = tgt.targetAcc;
          const accColor = accuracyToHeatColor(acc);
          const origColor = tagColorForCat((g.userData && g.userData.data && g.userData.data.category) || 'new');
          // Blend toward accuracy color
          sphere.material.color.lerp(new THREE.Color(accColor), lerpFactor * 0.5);
          sphere.material.emissive.set(sphere.material.color);
        }

        // Interpolate dot alpha for birth/death animation
        if (tgt.dotAlphaMap) {
          g.children.forEach(child => {
            if (child.isPoints && child.userData.type === 'dots') {
              const alphaAttr = child.geometry.attributes.aAlpha;
              if (!alphaAttr) return;
              if (!child.userData._baseAlphas) {
                child.userData._baseAlphas = new Float32Array(alphaAttr.count);
                for (let i = 0; i < alphaAttr.count; i++) {
                  child.userData._baseAlphas[i] = alphaAttr.getX(i);
                }
              }
              let changed = false;
              for (let i = 0; i < alphaAttr.count; i++) {
                const targetAlpha = (tgt.dotAlphaMap[i] !== undefined)
                  ? tgt.dotAlphaMap[i] * child.userData._baseAlphas[i]
                  : child.userData._baseAlphas[i];
                const current = alphaAttr.getX(i);
                const next = current + (targetAlpha - current) * lerpFactor * 2;
                if (Math.abs(next - current) > 0.001) {
                  alphaAttr.setX(i, next);
                  changed = true;
                }
              }
              if (changed) alphaAttr.needsUpdate = true;
            }
          });
        }
      });

      // Interpolate chapter sphere scales
      const chGroups = getChapterGroups();
      chGroups.forEach(g => {
        if (g.userData._snapTargets && g.userData._snapTargets.scale) {
          const sphere = g.children[0];
          if (sphere && sphere.scale) {
            const s = g.userData._snapTargets.scale;
            sphere.scale.lerp(new THREE.Vector3(s, s, s), lerpFactor);
          }
        }
      });
    }

    // SRS dimming every 60 frames (~1s)
    srsDimCounter++;
    if (srsDimCounter >= 60) {
      srsDimCounter = 0;
      applySRSDimming(tagGroups);
    }
  }

  loop();
}

function stopUIAnimLoop() {
  if (sm.animLoopId) {
    cancelAnimationFrame(sm.animLoopId);
    sm.animLoopId = null;
  }
  srsDimCounter = 0;
}

// ---- Global callbacks (called from detail panel HTML) ----

const _origSwitchChapter = window.switchChapter;
window.switchChapter = function (chId) {
  if (typeof _origSwitchChapter === 'function') _origSwitchChapter(chId);
};

window.openQBankForChapter = function (chId) {
  if (typeof _origSwitchChapter === 'function') _origSwitchChapter(chId);
  // Switch to question bank tab after navigating to chapter
  setTimeout(() => {
    if (typeof switchSubjTab === 'function') switchSubjTab('questionbank');
  }, 300);
};

window.clickPanelTag = function (tagId) {
  const tagGroups = getTagGroups();
  const tg = tagGroups[tagId];
  if (tg) {
    openDetailPanel(tg, 'tag');
    const target = tg.position.clone();
    flyCameraTo(target, target.clone().add(new THREE.Vector3(0, 0, 3)), 0.6);
  }
};

window.focusTagQuestions = function (tagId) {
  // Generate a focused exam for this specific tag
  if (typeof window.generateTagFocusedExam === 'function') {
    window.generateTagFocusedExam(tagId);
  }
};

window.viewTagQuestions = function (tagId) {
  const data = sm.data;
  if (!data) return;
  const tagQs = (data.questions || []).filter(q => q.tagId === tagId);
  const panelBody = document.getElementById('starmap-panel-body');
  if (!panelBody) return;

  let html = '<div class="question-mini-list"><h5>关联题目 (' + tagQs.length + ')</h5>';
  tagQs.slice(0, 50).forEach(q => {
    const status = q.isCorrect ? 'correct' : (q.isWrong ? 'wrong' : 'unanswered');
    const icon = q.isCorrect ? '✓' : (q.isWrong ? '✗' : '○');
    html += `<div class="question-mini ${status}"><span class="q-dot"></span>${icon} ${q.question || '(无题目文本)'}</div>`;
  });
  if (tagQs.length > 50) html += `<p style="font-size:10px;color:var(--text-muted);">仅显示前 50 题</p>`;
  html += '</div>';
  panelBody.innerHTML += html;
};

// Expose for global access
window.starmapOnTabActivate = starmapOnTabActivate;
window.starmapOnTabDeactivate = starmapOnTabDeactivate;
window.starmapRefreshData = async function (subjectId) {
  // Refresh after quiz session
  if (!subjectId) return;
  sm.data = null;
  await starmapOnTabActivate(subjectId);
};
