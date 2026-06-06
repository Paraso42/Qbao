// ===== Knowledge Star Map — Force Simulation + Spring Interpolation =====
import * as THREE from 'three';

const STIFFNESS = 6.0;
const DAMPING = 3.5;
const CHAPTER_REST_LENGTH = 20.0;
const TAG_ATTRACT_STRENGTH = 0.5;
const TAG_REPULSION_CUTOFF = 4.0;
const CENTER_GRAVITY = 0.015;
const MAX_SPRING_DELTA = 1.5;
const MIN_ALPHA = 0.005; // clamp max displacement per frame

let forceRunning = false;
let forceAlpha = 1.0;
let forceAlphaDecay = 0.02;
let simInterval = null;
let simIntervalMs = 33;

// Spring state: { position: Vector3, velocity: Vector3, target: Vector3 }
const springStates = new Map();

export function initForceSimulation(chapterGroups, tagGroups, edges) {
  // Initialize spring states for all chapter and tag nodes
  chapterGroups.forEach(g => {
    springStates.set(g.uuid, {
      position: g.position.clone(),
      velocity: new THREE.Vector3(),
      target: g.userData.targetPos ? g.userData.targetPos.clone() : g.position.clone(),
    });
  });

  Object.values(tagGroups).forEach(g => {
    springStates.set(g.uuid, {
      position: g.position.clone(),
      velocity: new THREE.Vector3(),
      target: g.userData.targetPos ? g.userData.targetPos.clone() : g.position.clone(),
    });
  });

  forceAlpha = 1.0;
  startForceLoop(chapterGroups, tagGroups, edges);
}

export function stopForceSimulation() {
  forceRunning = false;
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
}

let _chapterGroups = [];
let _tagGroups = {};

function startForceLoop(chapterGroups, tagGroups, edges) {
  if (forceRunning) return;
  forceRunning = true;
  simIntervalMs = 33;
  _chapterGroups = chapterGroups;
  _tagGroups = tagGroups;

  function step() {
    if (!forceRunning) return;

    applyChapterRepulsion(chapterGroups);
    applyCenterGravity(chapterGroups);
    applyTagForces(tagGroups, chapterGroups);
    applyTagRepulsion(tagGroups);

    forceAlpha = Math.max(MIN_ALPHA, forceAlpha * (1 - forceAlphaDecay));

    // Adaptive frequency: slow down as system settles, but never stop
    const nextMs = forceAlpha > 0.1 ? 33 : forceAlpha > 0.02 ? 66 : 150;
    if (nextMs !== simIntervalMs) {
      simIntervalMs = nextMs;
      clearInterval(simInterval);
      simInterval = setInterval(step, simIntervalMs);
    }
  }

  simInterval = setInterval(step, simIntervalMs);
}

export function boostForceAlpha(value) {
  if (forceAlpha < value) {
    forceAlpha = value;
  }
  // Reset to fast interval if needed
  if (simIntervalMs !== 33 && forceRunning) {
    simIntervalMs = 33;
    clearInterval(simInterval);
    function fastStep() {
      if (!forceRunning) return;
      applyChapterRepulsion(_chapterGroups);
      applyCenterGravity(_chapterGroups);
      applyTagForces(_tagGroups, _chapterGroups);
      applyTagRepulsion(_tagGroups);
      forceAlpha = Math.max(MIN_ALPHA, forceAlpha * (1 - forceAlphaDecay));
      const nextMs = forceAlpha > 0.1 ? 33 : forceAlpha > 0.02 ? 66 : 150;
      if (nextMs !== simIntervalMs) {
        simIntervalMs = nextMs;
        clearInterval(simInterval);
        simInterval = setInterval(fastStep, simIntervalMs);
      }
    }
    simInterval = setInterval(fastStep, 33);
  }
}

/** Chapter nodes repel each other */
function applyChapterRepulsion(chapters) {
  for (let i = 0; i < chapters.length; i++) {
    for (let j = i + 1; j < chapters.length; j++) {
      const a = chapters[i];
      const b = chapters[j];
      const dir = a.position.clone().sub(b.position);
      const dist = dir.length();
      if (dist < 0.1) continue;
      const force = CHAPTER_REST_LENGTH / Math.max(dist, 0.5);
      const norm = dir.normalize().multiplyScalar(force * forceAlpha * 0.5);
      displaceNode(a, norm);
      displaceNode(b, norm.clone().multiplyScalar(-1));
    }
  }
}

/** Pull chapters toward center (weaker Y to allow vertical spread) */
function applyCenterGravity(chapters) {
  chapters.forEach(g => {
    const toCenter = g.position.clone().multiplyScalar(-1);
    const dist = toCenter.length();
    if (dist < 0.1) return;
    toCenter.normalize().multiplyScalar(CENTER_GRAVITY * dist * forceAlpha);
    toCenter.y *= 0.3; // reduce vertical gravity
    displaceNode(g, toCenter);
  });
}

/** Tags attracted to their parent chapter, with Y-axis amplification for 3D */
function applyTagForces(tags, chapters) {
  const chapterMap = new Map();
  chapters.forEach(g => g.userData.id && chapterMap.set(g.userData.id, g));

  Object.values(tags).forEach(tag => {
    const ch = chapterMap.get(tag.userData.chapterId);
    if (!ch) return;

    const dir = ch.position.clone().sub(tag.position);
    const dist = dir.length();
    if (dist < 0.1) return;

    const idealDist = 5.0 + tag.userData.data.totalQ / 15;
    const diff = dist - idealDist;
    const force = TAG_ATTRACT_STRENGTH * diff * forceAlpha;
    dir.normalize().multiplyScalar(force);
    dir.y *= 1.3; // amplify vertical component
    displaceNode(tag, dir);
  });
}

/** Tags repel each other when too close, with Y-axis amplification */
function applyTagRepulsion(tags) {
  const tagArray = Object.values(tags);
  for (let i = 0; i < tagArray.length; i++) {
    for (let j = i + 1; j < tagArray.length; j++) {
      const a = tagArray[i];
      const b = tagArray[j];
      const dir = a.position.clone().sub(b.position);
      const dist = dir.length();
      if (dist > TAG_REPULSION_CUTOFF || dist < 0.05) continue;
      const force = (TAG_REPULSION_CUTOFF - dist) / TAG_REPULSION_CUTOFF * forceAlpha;
      dir.normalize().multiplyScalar(force * 0.3);
      dir.y *= 1.5; // amplify vertical repulsion
      displaceNode(a, dir);
      displaceNode(b, dir.clone().multiplyScalar(-1));
    }
  }
}

function displaceNode(group, delta) {
  const state = springStates.get(group.uuid);
  if (!state) return;
  state.target.add(delta);
}

/**
 * Apply spring-damper interpolation to all nodes.
 * Call this from the render loop (every frame).
 */
export function springStep(deltaTime) {
  const dt = Math.min(deltaTime, 0.05); // cap delta to avoid instability

  springStates.forEach((state) => {
    // F = stiffness * (target - position) - damping * velocity
    const dx = state.target.x - state.position.x;
    const dy = state.target.y - state.position.y;
    const dz = state.target.z - state.position.z;

    const fx = STIFFNESS * dx - DAMPING * state.velocity.x;
    const fy = STIFFNESS * dy - DAMPING * state.velocity.y;
    const fz = STIFFNESS * dz - DAMPING * state.velocity.z;

    // Semi-implicit Euler with clamped delta
    let dpx = fx * dt;
    let dpy = fy * dt;
    let dpz = fz * dt;
    const dMag = Math.sqrt(dpx * dpx + dpy * dpy + dpz * dpz);
    if (dMag > MAX_SPRING_DELTA) {
      const scale = MAX_SPRING_DELTA / dMag;
      dpx *= scale; dpy *= scale; dpz *= scale;
    }

    state.velocity.x += fx * dt;
    state.velocity.y += fy * dt;
    state.velocity.z += fz * dt;
    state.position.x += dpx;
    state.position.y += dpy;
    state.position.z += dpz;
  });
}

/**
 * Apply spring positions back to Three.js objects.
 */
export function applySpringPositions(chapterGroups, tagGroups) {
  chapterGroups.forEach(g => {
    const state = springStates.get(g.uuid);
    if (state) g.position.copy(state.position);
  });

  Object.values(tagGroups).forEach(g => {
    const state = springStates.get(g.uuid);
    if (state) g.position.copy(state.position);
  });
}

/** Reset all spring targets to current positions */
export function resetSpringTargets(chapterGroups, tagGroups) {
  chapterGroups.forEach(g => {
    const state = springStates.get(g.uuid);
    if (state) {
      state.target.copy(g.position);
      state.velocity.set(0, 0, 0);
    }
  });
  Object.values(tagGroups).forEach(g => {
    const state = springStates.get(g.uuid);
    if (state) {
      state.target.copy(g.position);
      state.velocity.set(0, 0, 0);
    }
  });
}

export function isForceActive() {
  return forceRunning && forceAlpha >= 0.0005;
}

export function getForceAlpha() {
  return forceAlpha;
}

export function getSpringState(uuid) {
  return springStates.get(uuid) || null;
}

// Expose for global access
window.initForceSimulation = initForceSimulation;
window.stopForceSimulation = stopForceSimulation;
window.springStep = springStep;
window.applySpringPositions = applySpringPositions;
window.resetSpringTargets = resetSpringTargets;
window.isForceActive = isForceActive;
window.getForceAlpha = getForceAlpha;
