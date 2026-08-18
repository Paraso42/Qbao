<!--
  AvatarCropDialog.vue — 头像裁剪弹窗（自 legacy users.js initAvatarCrop/confirmAvatarCrop）
  选图 → 方形裁剪（缩放/拖拽）→ canvas 圆形裁剪 → dataURL(jpeg 0.9) → emit confirm。
-->
<template>
  <Modal :open="open" :closable="true" :close-on-overlay="true" @close="cancel">
    <div class="crop-dialog">
      <h3 class="crop-title">裁剪头像</h3>
      <div class="crop-body">
        <div
          class="crop-viewport"
          @mousedown="onDragStart"
          @touchstart="onTouchStart"
        >
          <img
            ref="imgRef"
            :src="src"
            class="crop-img"
            :style="imgStyle"
            draggable="false"
            alt=""
            @load="onImgLoad"
          >
          <div class="crop-mask"></div>
        </div>
      </div>
      <div class="crop-tip">拖动图片调整位置，缩放调整取景范围（图片始终铺满裁剪框）</div>
      <div class="crop-controls">
        <span>缩放</span>
        <input v-model.number="zoom" type="range" :min="minZoom" max="300" step="1">
        <span class="crop-zoom-val">{{ zoom }}%</span>
      </div>
      <div class="dialog-actions">
        <button class="btn btn-secondary btn-small" @click="cancel">取消</button>
        <button class="btn btn-primary btn-small" :disabled="!ready" @click="confirm">确认</button>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount } from 'vue'
import Modal from '../../ui/Modal.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  src: { type: String, default: '' }
})
const emit = defineEmits(['close', 'confirm', 'error'])

const VIEWPORT = 280
const OUTPUT = 200

const imgRef = ref(null)
const zoom = ref(100)
const imgStyle = ref({})
const ready = ref(false)
const minZoom = computed(() => minZoomPct())
// 非响应式的适配几何信息（naturalW/H、适配后宽高、偏移）
let fit = null
let dragging = false
let dragStartX = 0
let dragStartY = 0
let origOffsetX = 0
let origOffsetY = 0

// 保证图片始终完全覆盖视口的最小缩放百分比（cover 适配后至少 100%）
function minZoomPct() {
  if (!fit) return 100
  const need = Math.max(VIEWPORT / fit.displayW, VIEWPORT / fit.displayH)
  return Math.max(100, Math.ceil(need * 100))
}

function clampOffset() {
  if (!fit) return
  const minZ = minZoomPct()
  if (zoom.value < minZ) zoom.value = minZ
  const s = zoom.value / 100
  const displayW = fit.displayW * s
  const displayH = fit.displayH * s
  // 图片必须完全覆盖视口：偏移不允许为正（露白边），且右/下边缘不能缩进视口内
  fit.offsetX = Math.min(0, Math.max(VIEWPORT - displayW, fit.offsetX))
  fit.offsetY = Math.min(0, Math.max(VIEWPORT - displayH, fit.offsetY))
}

function renderStyle() {
  if (!fit) { imgStyle.value = {}; return }
  clampOffset()
  const s = zoom.value / 100
  imgStyle.value = {
    width: fit.displayW + 'px',
    height: fit.displayH + 'px',
    transform: 'translate(' + fit.offsetX + 'px,' + fit.offsetY + 'px) scale(' + s + ')'
  }
}

function onImgLoad() {
  const img = imgRef.value
  if (!img) return
  const naturalW = img.naturalWidth
  const naturalH = img.naturalHeight
  if (!naturalW || !naturalH) {
    emit('error', '图片读取失败，请更换图片')
    return
  }
  // cover 适配：铺满正方形视口
  const scale = Math.max(VIEWPORT / naturalW, VIEWPORT / naturalH)
  const displayW = naturalW * scale
  const displayH = naturalH * scale
  fit = { naturalW, naturalH, displayW, displayH, offsetX: (VIEWPORT - displayW) / 2, offsetY: (VIEWPORT - displayH) / 2 }
  if (zoom.value < minZoomPct()) zoom.value = minZoomPct()
  ready.value = true
  renderStyle()
}

// —— 拖拽（鼠标 + 触屏） ——
function onDragStart(e) {
  if (!fit) return
  e.preventDefault()
  dragging = true
  dragStartX = e.clientX
  dragStartY = e.clientY
  origOffsetX = fit.offsetX
  origOffsetY = fit.offsetY
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
}
function onMouseMove(e) {
  if (!dragging || !fit) return
  fit.offsetX = origOffsetX + (e.clientX - dragStartX)
  fit.offsetY = origOffsetY + (e.clientY - dragStartY)
  renderStyle()
}
function onMouseUp() {
  dragging = false
  removeMouseListeners()
}
function removeMouseListeners() {
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mouseup', onMouseUp)
}

function onTouchStart(e) {
  if (!fit || e.touches.length !== 1) return
  dragging = true
  dragStartX = e.touches[0].clientX
  dragStartY = e.touches[0].clientY
  origOffsetX = fit.offsetX
  origOffsetY = fit.offsetY
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onTouchEnd)
}
function onTouchMove(e) {
  if (!dragging || !fit || e.touches.length !== 1) return
  e.preventDefault()
  fit.offsetX = origOffsetX + (e.touches[0].clientX - dragStartX)
  fit.offsetY = origOffsetY + (e.touches[0].clientY - dragStartY)
  renderStyle()
}
function onTouchEnd() {
  dragging = false
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
}

function confirm() {
  const img = imgRef.value
  if (!img || !fit) return
  let dataUrl = null
  try {
    const s = zoom.value / 100
    const displayW = fit.displayW * s
    const displayH = fit.displayH * s
    const naturalW = fit.naturalW
    const naturalH = fit.naturalH
    const imgCenterX = fit.offsetX + displayW / 2
    const imgCenterY = fit.offsetY + displayH / 2
    const vpCenter = VIEWPORT / 2
    const srcX = (vpCenter - imgCenterX) / displayW * naturalW
    const srcY = (vpCenter - imgCenterY) / displayH * naturalH
    const srcSize = VIEWPORT / displayW * naturalW

    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.beginPath()
    ctx.arc(OUTPUT / 2, OUTPUT / 2, OUTPUT / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT)
    ctx.restore()

    dataUrl = canvas.toDataURL('image/jpeg', 0.9)
  } catch (e) {
    emit('error', (e && e.message) || '图片处理失败，请更换图片重试')
    return
  }
  emit('confirm', dataUrl)
}

function reset() {
  zoom.value = 100
  fit = null
  ready.value = false
  imgStyle.value = {}
  dragging = false
  removeMouseListeners()
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
}

function cancel() {
  reset()
  emit('close')
}

watch(() => props.open, (open) => { if (open) reset() })
watch(zoom, () => renderStyle())
onBeforeUnmount(() => {
  removeMouseListeners()
  window.removeEventListener('touchmove', onTouchMove)
  window.removeEventListener('touchend', onTouchEnd)
})
</script>

<style scoped>
.crop-dialog { display: flex; flex-direction: column; }
.crop-title { margin-bottom: var(--space-md); }
.crop-tip {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  text-align: center;
  margin-bottom: var(--space-sm);
}
.crop-body { display: flex; justify-content: center; margin-bottom: var(--space-md); }
.crop-viewport {
  position: relative;
  width: 280px;
  height: 280px;
  max-width: 100%;
  border-radius: 50%;
  overflow: hidden;
  background: var(--surface-bg);
  cursor: grab;
  touch-action: none;
}
.crop-img {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  user-select: none;
  -webkit-user-drag: none;
  max-width: none;
  cursor: grab;
}
.crop-img:active { cursor: grabbing; }
.crop-mask {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  pointer-events: none;
}
.crop-controls {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}
.crop-controls span { font-size: var(--fs-sm); color: var(--text-secondary); min-width: 40px; }
.crop-zoom-val { text-align: right; }
.crop-controls input[type='range'] {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: var(--border-default);
  outline: none;
  cursor: pointer;
}
.crop-controls input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--color-primary);
  cursor: pointer;
  border: none;
}
</style>
