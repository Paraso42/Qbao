// ===== Knowledge Star Map — Three.js Renderer =====
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Reusable geometries (shared across all nodes)
let sphereGeoChapter, sphereGeoTag, sphereGeoDot;

// Shader material for question dot glow
const dotVertexShader = /* glsl */`
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (250.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const dotFragmentShader = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = (1.0 - smoothstep(0.0, 0.5, dist)) * vAlpha;
    gl_FragColor = vec4(vColor, alpha);
  }
`;

// Scene objects references
let scene, camera, renderer, controls, clock;
let composer, bloomPass;
let starfield;
let chapterGroups = [];
let tagGroups = {};
let tagDotClouds = {};
let tagToChapterLines = [];
let chapterLabelSprites = [];

// State
let animId = null;
let sceneReady = false;
let nodeData = null;
let isMobile = false;

export function initStarmapScene(container) {
  if (sceneReady) return;

  // Mobile detection
  isMobile = /iPhone|iPad|Android|Mobile/i.test(navigator.userAgent)
    || window.innerWidth < 768;

  const width = container.clientWidth;
  const height = container.clientHeight;

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  container.appendChild(renderer.domElement);

  // Prevent browser context menu on right-click drag
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

  // Scene
  scene = new THREE.Scene();
  updateSceneBackground();

  // Camera
  camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 200);
  camera.position.set(0, 8, 30);
  camera.lookAt(0, 0, 0);

  // Controls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 80;
  controls.target.set(0, 0, 0);
  controls.update();

  // Clock
  clock = new THREE.Clock();

  // Lighting
  const ambient = new THREE.AmbientLight(0x334466, 1.5);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 1.2);
  directional.position.set(10, 20, 15);
  scene.add(directional);
  const point = new THREE.PointLight(0x5b8fd4, 2, 50);
  point.position.set(0, 5, 10);
  scene.add(point);

  // Post-processing
  composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(width, height),
    isMobile ? 0.5 : 1.2,   // strength
    isMobile ? 0.3 : 0.5,   // radius
    0.3,                      // threshold (lower = more elements bloom)
  );
  composer.addPass(bloomPass);

  // Shared geometries (registered in WeakSet to avoid disposal)
  sphereGeoChapter = new THREE.SphereGeometry(1, 32, 32);
  sphereGeoTag = new THREE.SphereGeometry(1, 24, 24);
  sphereGeoDot = new THREE.SphereGeometry(0.08, 4, 4);
  SHARED_GEOS.add(sphereGeoChapter).add(sphereGeoTag).add(sphereGeoDot);

  // Starfield
  createStarfield();

  sceneReady = true;
}

export function updateSceneBackground() {
  if (!scene) return;
  const isDark = document.body.classList.contains('dark-mode');
  scene.background = new THREE.Color(isDark ? 0x06060d : 0x0d0d1f);
}

function createStarfield() {
  const count = isMobile ? 300 : 800;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = 45 + Math.random() * 10;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.08,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.7,
  });
  starfield = new THREE.Points(geo, mat);
  scene.add(starfield);
}

/** Create or update all chapter/tag/dot nodes from API data */
export function starmapRenderNodes(data) {
  if (!sceneReady) return;
  nodeData = data;
  clearNodes();

  const { chapters, tags, questions, edges, similarityMatrix } = data;
  if (!chapters || chapters.length === 0) return;

  // Layout parameters
  const chapterSpacing = 18;
  const tagRadius = 7;

  // --- Chapters ---
  chapterGroups = [];
  chapters.forEach((ch, i) => {
    const angle = (i / chapters.length) * Math.PI * 2;
    const cx = Math.cos(angle) * chapterSpacing;
    const cz = Math.sin(angle) * chapterSpacing;

    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.userData = { type: 'chapter', id: ch.id, name: ch.name, data: ch, targetPos: group.position.clone() };

    // Chapter sphere
    const scale = 1.0 + Math.min(ch.totalQ / 100, 0.8);
    const baseEmissiveIntensity = 0.5 + ch.accuracy * 0.4;
    const mat = new THREE.MeshStandardMaterial({
      color: 0xfff8f0,
      roughness: 0.6,
      metalness: 0.05,
      transparent: true,
      opacity: 0.85,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: baseEmissiveIntensity,
    });
    const sphere = new THREE.Mesh(sphereGeoChapter, mat);
    sphere.scale.setScalar(scale);
    sphere.userData = { type: 'chapter', id: ch.id, name: ch.name, _baseEmissiveIntensity: baseEmissiveIntensity };
    group.add(sphere);

    // Orbit ring
    const ringGeo = new THREE.TorusGeometry(scale * 1.4, 0.04, 16, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Chapter label sprite (skip on mobile for performance)
    if (!isMobile) {
      const chLabel = createLabelSprite(ch.name, {
        fontSize: 28, color: '#ffffff', bgAlpha: 0.25,
      });
      chLabel.position.set(0, scale * 2.2, 0);
      group.add(chLabel);
      chapterLabelSprites.push(chLabel);
    }

    scene.add(group);
    chapterGroups.push(group);

    // --- Tags for this chapter ---
    const chTags = tags.filter(t => t.chapterId === ch.id);
    chTags.forEach((tag, j) => {
      const ta = (j / Math.max(chTags.length, 1)) * Math.PI * 2;
      const tr = tagRadius + Math.random() * 2;
      const tx = cx + Math.cos(ta) * tr;
      const tz = cz + Math.sin(ta) * tr;
      const ty = (Math.random() - 0.5) * 8;

      const tagGroup = new THREE.Group();
      tagGroup.position.set(tx, ty, tz);
      tagGroup.userData = {
        type: 'tag', id: tag.id, label: tag.label, chapterId: ch.id,
        data: tag, targetPos: tagGroup.position.clone(),
      };

      // Tag sphere
      const tagColor = tagColorForCategory(tag.category);
      const tagScale = 0.3 + Math.min(tag.totalQ / 30, 0.5);
      const tagMat = new THREE.MeshStandardMaterial({
        color: tagColor,
        roughness: 0.4,
        metalness: 0.1,
        emissive: tagColor,
        emissiveIntensity: 0.3,
      });
      tagSphere.userData = { type: 'tag', id: tag.id, label: tag.label, _baseEmissiveIntensity: 0.3 };
      const tagSphere = new THREE.Mesh(sphereGeoTag, tagMat);
      tagSphere.scale.setScalar(tagScale);
      tagSphere.userData = { type: 'tag', id: tag.id, label: tag.label, _baseEmissiveIntensity: 0.3 };
      tagGroup.add(tagSphere);

      // Tag label sprite (skip on mobile)
      if (!isMobile) {
        const tagLabel = createLabelSprite(tag.label || tag.id, {
          fontSize: 20, color: '#dddddd', bgAlpha: 0.15,
        });
        tagLabel.position.set(0, tagScale * 2.5, 0);
        tagGroup.add(tagLabel);
        chapterLabelSprites.push(tagLabel);
      }

      scene.add(tagGroup);
      tagGroups[tag.id] = tagGroup;

      // Question dots for this tag
      const tagQs = questions.filter(q => q.tagId === tag.id);
      createDotCloud(tagGroup, tagQs, similarityMatrix[tag.id]);

      // Line from tag to chapter
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(tx, ty, tz),
        new THREE.Vector3(cx, 0, cz),
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x4facfe,
        transparent: true,
        opacity: 0.12,
      });
      const line = new THREE.Line(lineGeo, lineMat);
      scene.add(line);
      tagToChapterLines.push({ line, tagId: tag.id, chapterGroup: group });
    });
  });

  // Start animation loop if not running
  if (!animId) startLoop();
}

function tagColorForCategory(cat) {
  switch (cat) {
    case 'error': return 0xffcccc;
    case 'review': return 0xccddff;
    default: return 0xe8e8f0;
  }
}

function createDotCloud(parentGroup, questions, simMatrix) {
  if (!questions || questions.length === 0) return;

  const n = questions.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const alphas = new Float32Array(n);

  const shellRadius = 1.2 + parentGroup.userData.data.totalQ / 15;
  const correctColor = new THREE.Color(0.2, 0.8, 0.5);
  const wrongColor = new THREE.Color(0.9, 0.3, 0.2);

  // Distribute dots on a spherical shell, biasing correct/wrong to opposite sides
  for (let i = 0; i < n; i++) {
    const q = questions[i];
    let theta, phi;

    if (q.isWrong) {
      // Wrong answers cluster on one hemisphere
      theta = Math.random() * Math.PI * 2;
      phi = Math.random() * Math.PI * 0.6 + Math.PI * 0.7;
    } else if (q.isCorrect) {
      // Correct answers on opposite hemisphere
      theta = Math.random() * Math.PI * 2;
      phi = Math.random() * Math.PI * 0.6 + Math.PI * 0.1;
    } else {
      theta = Math.random() * Math.PI * 2;
      phi = Math.acos(2 * Math.random() - 1);
    }

    const r = shellRadius * (0.8 + Math.random() * 0.4);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    const color = q.isWrong ? wrongColor : correctColor;
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;

    sizes[i] = 0.12 + Math.random() * 0.10;
    alphas[i] = 0.8 + Math.random() * 0.2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: dotVertexShader,
    fragmentShader: dotFragmentShader,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });

  const points = new THREE.Points(geo, mat);
  points.userData = {
    type: 'dots',
    tagId: parentGroup.userData.id,
    questionData: questions,
  };
  parentGroup.add(points);

  const parentTagId = parentGroup.userData.id;
  if (!tagDotClouds[parentTagId]) tagDotClouds[parentTagId] = [];
  tagDotClouds[parentTagId].push(points);
}

const SHARED_GEOS = new WeakSet();

/**
 * Create a canvas-texture sprite for floating labels above nodes.
 * Returns a THREE.Sprite positioned relative to the parent group.
 */
function createLabelSprite(text, options = {}) {
  const {
    fontSize = 48,
    color = '#ffffff',
    bgAlpha = 0.0,
    padding = 8,
  } = options;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  // Measure text first
  ctx.font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  const metrics = ctx.measureText(text);
  const textWidth = metrics.width;
  const textHeight = fontSize * 1.2;

  canvas.width = Math.ceil(textWidth + padding * 2);
  canvas.height = Math.ceil(textHeight + padding * 2);

  // Re-set font after canvas resize
  ctx.font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Optional dark background for readability
  if (bgAlpha > 0) {
    ctx.fillStyle = `rgba(0,0,0,${bgAlpha})`;
    const bx = canvas.width / 2 - textWidth / 2 - 6;
    const by = canvas.height / 2 - textHeight / 2 - 2;
    ctx.fillRect(bx, by, textWidth + 12, textHeight + 4);
  }

  // Text shadow for depth
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 4;
  ctx.fillStyle = color;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.premultiplyAlpha = true;

  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(spriteMat);
  const aspect = canvas.width / canvas.height;
  const scaleY = 1.0;
  sprite.scale.set(aspect * scaleY, scaleY, 1);
  sprite.userData._baseScaleX = aspect * scaleY;
  sprite.userData._baseScaleY = scaleY;

  return sprite;
}

function clearNodes() {
  // Remove chapter groups (skip shared geometries)
  chapterGroups.forEach(g => {
    g.traverse(child => {
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => { if (!SHARED_GEOS.has(m)) m.dispose(); });
        } else {
          if (!SHARED_GEOS.has(child.material)) child.material.dispose();
        }
      }
      if (child.geometry && !SHARED_GEOS.has(child.geometry)) {
        child.geometry.dispose();
      }
    });
    scene.remove(g);
  });
  chapterGroups = [];

  // Remove tag groups
  Object.values(tagGroups).forEach(g => {
    g.traverse(child => {
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => { if (!SHARED_GEOS.has(m)) m.dispose(); });
        } else {
          if (!SHARED_GEOS.has(child.material)) child.material.dispose();
        }
      }
      if (child.geometry && !SHARED_GEOS.has(child.geometry)) {
        child.geometry.dispose();
      }
    });
    scene.remove(g);
  });
  tagGroups = {};
  tagDotClouds = {};

  // Remove lines
  tagToChapterLines.forEach(({ line }) => {
    line.material.dispose();
    line.geometry.dispose();
    scene.remove(line);
  });
  tagToChapterLines = [];
  chapterLabelSprites = [];
}

export function updateAllConnectionLines(chapterGroups, tagGroups) {
  // Update tag→chapter lines
  tagToChapterLines.forEach(({ line, tagId, chapterGroup }) => {
    const tagGroup = tagGroups[tagId];
    if (!tagGroup || !chapterGroup) return;
    const pos = line.geometry.attributes.position;
    pos.setXYZ(0, tagGroup.position.x, tagGroup.position.y, tagGroup.position.z);
    pos.setXYZ(1, chapterGroup.position.x, chapterGroup.position.y, chapterGroup.position.z);
    pos.needsUpdate = true;
  });
}

/**
 * Apply SRS forgetting curve dimming to question dots under a tag.
 * Each dot dims independently based on its lastReviewTime from the backend.
 * alpha = baseAlpha * exp(-daysSinceReview / halfLifeDays)
 */
export function applySRSDimming(tagGroups) {
  const now = Date.now();
  const DAY_MS = 86400000;
  const halfLife = 14; // ~14 days for unreviewed knowledge

  Object.values(tagGroups).forEach(tagGroup => {
    tagGroup.children.forEach(child => {
      if (child.isPoints && child.userData.type === 'dots') {
        const alphaAttr = child.geometry.attributes.aAlpha;
        if (!alphaAttr) return;
        const qData = child.userData.questionData;
        if (!qData) return;

        // Store base alphas on first call
        if (!child.userData._baseAlphas) {
          child.userData._baseAlphas = new Float32Array(alphaAttr.count);
          for (let i = 0; i < alphaAttr.count; i++) {
            child.userData._baseAlphas[i] = alphaAttr.getX(i);
          }
        }

        for (let i = 0; i < alphaAttr.count; i++) {
          const base = child.userData._baseAlphas[i];
          const lastReview = qData[i] && qData[i].lastReviewTime || 0;
          const daysSince = lastReview > 0 ? (now - lastReview) / DAY_MS : 30; // never reviewed = 30 days
          const dimFactor = Math.exp(-daysSince / halfLife);
          // Wrong answers dim slower (you remember mistakes better), correct answers dim slightly faster
          const bias = (qData[i] && qData[i].isWrong) ? 1.8 : 1.0;
          alphaAttr.setX(i, base * Math.max(0.06, Math.pow(dimFactor, bias)));
        }
        alphaAttr.needsUpdate = true;
      }
    });
  });
}

function startLoop() {
  function animate() {
    animId = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    applyIdleAnimation(dt);
    controls.update();
    composer.render();
  }
  animate();
}

function applyIdleAnimation(dt) {
  const time = performance.now() * 0.001;

  chapterGroups.forEach((g, i) => {
    const sphere = g.children[0];
    if (!sphere || !sphere.material) return;

    // Slow Y-axis rotation for planet-like feel
    g.rotation.y += dt * 0.08;

    // Emissive breathing pulse
    const baseIntensity = sphere.userData._baseEmissiveIntensity || 0.5;
    if (sphere.material.emissiveIntensity !== undefined) {
      sphere.material.emissiveIntensity = baseIntensity + Math.sin(time * 0.5 + i) * 0.08;
    }
  });

  Object.values(tagGroups).forEach((g, i) => {
    const sphere = g.children[0];
    if (!sphere || !sphere.material) return;

    // Gentle rotation
    g.rotation.y += dt * 0.05;

    // Emissive pulse
    const baseIntensity = sphere.userData._baseEmissiveIntensity || 0.3;
    if (sphere.material.emissiveIntensity !== undefined) {
      sphere.material.emissiveIntensity = baseIntensity + Math.sin(time * 0.5 + i * 0.7) * 0.05;
    }
  });

  // Slow starfield rotation for immersion
  if (starfield) {
    starfield.rotation.y += dt * 0.02;
    starfield.rotation.x += dt * 0.005;
  }
}

export function stopRenderLoop() {
  if (animId) {
    cancelAnimationFrame(animId);
    animId = null;
  }
}

export function resizeStarmap(container) {
  if (!sceneReady) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloomPass.resolution.set(w, h);
}

export function getStarmapScene() { return scene; }
export function getStarmapCamera() { return camera; }
export function getStarmapControls() { return controls; }
export function getStarmapRenderer() { return renderer; }
export function getStarmapClock() { return clock; }
export function getChapterGroups() { return chapterGroups; }
export function getTagGroups() { return tagGroups; }
export function getDotClouds() { return tagDotClouds; }
export function getLabelSprites() { return chapterLabelSprites; }
export function getNodeData() { return nodeData; }
export function isSceneReady() { return sceneReady; }

/** Fly camera to a target position with ease-out animation */
export function flyCameraTo(targetPos, lookAtPos, duration = 1.0) {
  if (!sceneReady) return;
  const startPos = camera.position.clone();
  const startTarget = controls.target.clone();
  const endPos = targetPos.clone();
  const endTarget = lookAtPos ? lookAtPos.clone() : targetPos.clone().add(new THREE.Vector3(0, 0, 5));
  const startTime = performance.now() / 1000;

  function flyStep() {
    const elapsed = performance.now() / 1000 - startTime;
    const t = Math.min(elapsed / duration, 1.0);
    const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic
    camera.position.lerpVectors(startPos, endPos, ease);
    controls.target.lerpVectors(startTarget, endTarget, ease);
    if (t < 1) {
      requestAnimationFrame(flyStep);
    }
  }
  flyStep();
}

/** Update question dot colors after a quiz session */
export function updateDotColors(tagId, questions) {
  const clouds = tagDotClouds[tagId];
  if (!clouds) return;

  const correctColor = new THREE.Color(0.2, 0.8, 0.5);
  const wrongColor = new THREE.Color(0.9, 0.3, 0.2);

  clouds.forEach(points => {
    const colorAttr = points.geometry.attributes.aColor;
    if (!colorAttr) return;
    for (let i = 0; i < Math.min(questions.length, colorAttr.count); i++) {
      const color = questions[i].isWrong ? wrongColor : correctColor;
      colorAttr.setXYZ(i, color.r, color.g, color.b);
    }
    colorAttr.needsUpdate = true;
  });
}

// Expose for global access
window.initStarmapScene = initStarmapScene;
window.starmapRenderNodes = starmapRenderNodes;
window.updateSceneBackground = updateSceneBackground;
window.resizeStarmap = resizeStarmap;
window.stopRenderLoop = stopRenderLoop;
window.flyCameraTo = flyCameraTo;
window.updateDotColors = updateDotColors;
window.getStarmapScene = getStarmapScene;
window.getStarmapCamera = getStarmapCamera;
window.getStarmapControls = getStarmapControls;
window.getStarmapRenderer = getStarmapRenderer;
window.getChapterGroups = getChapterGroups;
window.getTagGroups = getTagGroups;
window.getDotClouds = getDotClouds;
window.getLabelSprites = getLabelSprites;
window.getNodeData = getNodeData;
window.isSceneReady = isSceneReady;
window.updateAllConnectionLines = updateAllConnectionLines;
window.applySRSDimming = applySRSDimming;
