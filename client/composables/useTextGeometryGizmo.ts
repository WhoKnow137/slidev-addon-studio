import type { Handle, Point, Size } from '../../shared/geometry'
import type { TextDocument } from '../../shared/studiotext'
import type { Box, Guide } from './useSnapping'
import type { useSlideCanvas } from './useSlideCanvas'
import { shallowRef } from 'vue'
import { applyGeometry, screenToSlide, slideToScreen, snapAngle } from '../../shared/geometry'
import { activeText, studioGeometryBatchCommand, studioGeometryCommand, textError, textSelection } from '../studiotext-editor'
import { readStudioTextMeasurement, studioTextHost } from '../studio-text-measurement'
import { snapEnabled } from '../state'
import { onDomEvent } from './useDomEvent'
import { snapBox } from './useSnapping'

type Gesture = { kind: 'move' } | { kind: 'resize', handle: Handle } | { kind: 'rotate' }
interface ActiveGesture {
  gesture: Gesture
  no: number
  id: string
  host: HTMLElement
  originalStyle: string | null
  original: TextDocument
  measurement: Size
  start: Point
  startAngle: number
  moved: boolean
  draft: TextDocument
  group: { host: HTMLElement, style: string | null, x: number, y: number }[]
}

/** Managed-text preview only. Persistence always goes through the guarded text service. */
export function useTextGeometryGizmo(canvas: ReturnType<typeof useSlideCanvas>) {
  const guides = shallowRef<Guide[]>([])
  let running: ActiveGesture | null = null
  const transform = () => ({ left: canvas.rect.value.left, top: canvas.rect.value.top, scale: canvas.scale.value })
  const point = (event: PointerEvent) => screenToSlide({ x: event.clientX, y: event.clientY }, transform())
  const box = (doc: TextDocument, measurement: Size): Box => ({
    x: doc.geometry.x, y: doc.geometry.y,
    w: doc.geometry.width ?? measurement.width, h: doc.geometry.height ?? measurement.height,
  })
  function otherBoxes(no: number, ids: string[]): Box[] {
    const slide = canvas.el.value
    if (!slide) return []
    return [...slide.querySelectorAll<HTMLElement>(`[data-slidev-no="${no}"] [data-studio-text-id]`)]
      .filter(host => !ids.includes(host.dataset.studioTextId ?? ''))
      .map(host => canvas.boxOf(host))
  }
  function paint(draft: TextDocument) {
    if (!running) return
    const host = running.host
    const g = draft.geometry
    host.style.left = `${g.x}px`; host.style.top = `${g.y}px`
    host.style.width = g.width === null ? 'max-content' : `${g.width}px`
    host.style.height = g.height === null ? 'auto' : `${g.height}px`
    host.style.whiteSpace = draft.resizeMode === 'auto-width' && g.maxWidth == null ? 'pre' : 'pre-wrap'
    host.style.transform = `rotate(${g.rotationDeg}deg)`
    const dx = g.x - running.original.geometry.x; const dy = g.y - running.original.geometry.y
    for (const item of running.group) {
      item.host.style.left = `${item.x + dx}px`
      item.host.style.top = `${item.y + dy}px`
    }
  }
  function restore() {
    if (running?.host.isConnected) {
      if (running.originalStyle === null) running.host.removeAttribute('style')
      else running.host.setAttribute('style', running.originalStyle)
    }
    for (const item of running?.group ?? []) {
      if (!item.host.isConnected) continue
      if (item.style === null) item.host.removeAttribute('style')
      else item.host.setAttribute('style', item.style)
    }
    guides.value = []
    running = null
  }
  function start(event: PointerEvent, gesture: Gesture) {
    if (event.button !== 0 || activeText.value?.editing || activeText.value?.stale) return
    const state = activeText.value
    if (!state?.document || state.document.geometry.affine) return
    const groupIds = textSelection.value.mode === 'objects' ? textSelection.value.ids.slice(1) : []
    if (groupIds.length && gesture.kind !== 'move') return
    const host = studioTextHost(state.no, state.id)
    if (!host || host.dataset.studioTextPos !== [state.document.geometry.x, state.document.geometry.y,
      state.document.geometry.width ?? 'auto', state.document.geometry.height ?? 'auto'].join(',')) return
    if (document.fonts?.status === 'loading') { textError.value = 'Wait for the current font to load before changing geometry.'; return }
    let measurement: Size
    try { measurement = readStudioTextMeasurement(host) }
    catch (error) { textError.value = (error as Error).message; return }
    const start = point(event)
    const frame = box(state.document, measurement)
    const center = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }
    const group = groupIds.map(id => {
      const item = studioTextHost(state.no, id)
      const parts = item?.dataset.studioTextPos?.split(',')
      if (!item || !parts || !Number.isFinite(Number(parts[0])) || !Number.isFinite(Number(parts[1]))) return null
      return { host: item, style: item.getAttribute('style'), x: Number(parts[0]), y: Number(parts[1]) }
    }).filter(item => item !== null)
    if (group.length !== groupIds.length) { textError.value = 'Multi-object source frame is unavailable'; return }
    event.preventDefault(); event.stopPropagation()
    running = { gesture, no: state.no, id: state.id, host, originalStyle: host.getAttribute('style'), group,
      original: state.document, measurement, start,
      startAngle: Math.atan2(start.y - center.y, start.x - center.x) * 180 / Math.PI,
      moved: false, draft: state.document }
  }
  onDomEvent<PointerEvent>(window, 'pointermove', (event) => {
    if (!running) return
    const current = point(event)
    const dx = current.x - running.start.x; const dy = current.y - running.start.y
    if (!running.moved && Math.hypot(event.clientX - slideToScreen(running.start, transform()).x,
      event.clientY - slideToScreen(running.start, transform()).y) < 4) return
    running.moved = true
    const original = running.original
    const measurement = running.measurement
    let next: TextDocument
    if (running.gesture.kind === 'move') next = applyGeometry(original, { kind: 'translate', dx, dy })
    else if (running.gesture.kind === 'resize') next = applyGeometry(original,
      { kind: 'resize', handle: running.gesture.handle, dx, dy, measurement })
    else {
      const frame = box(original, measurement)
      const center = { x: frame.x + frame.w / 2, y: frame.y + frame.h / 2 }
      const angle = Math.atan2(current.y - center.y, current.x - center.x) * 180 / Math.PI
      next = applyGeometry(original, { kind: 'set', property: 'rotationDeg',
        value: snapAngle(original.geometry.rotationDeg + angle - running.startAngle, event.shiftKey) })
    }
    if (running.gesture.kind !== 'rotate' && snapEnabled.value && !event.altKey) {
      const frame = box(next, measurement)
      const handle = running.gesture.kind === 'resize' ? running.gesture.handle : null
      const snapped = snapBox(frame, { canvas: { w: canvas.slideWidth.value, h: canvas.slideHeight.value },
        others: otherBoxes(running.no, [running.id, ...running.group.map(item => item.host.dataset.studioTextId ?? '')]),
        threshold: 6 / canvas.scale.value,
        edges: handle ? { left: handle.includes('w'), right: handle.includes('e'),
          top: handle.includes('n'), bottom: handle.includes('s') } : undefined })
      guides.value = snapped.guides
      const g = next.geometry
      g.x = snapped.box.x; g.y = snapped.box.y
      if (g.width !== null) g.width = snapped.box.w
      if (g.height !== null) g.height = snapped.box.h
    }
    else guides.value = []
    running.draft = next
    paint(next)
  })
  onDomEvent<PointerEvent>(window, 'pointerup', async () => {
    const gesture = running
    if (!gesture) return
    if (!gesture.moved || activeText.value?.id !== gesture.id || activeText.value.no !== gesture.no) { restore(); return }
    const draft = gesture.draft
    const success = gesture.group.length
      ? await studioGeometryBatchCommand({ kind: 'translate',
          dx: draft.geometry.x - gesture.original.geometry.x, dy: draft.geometry.y - gesture.original.geometry.y })
      : await studioGeometryCommand({ kind: 'frame', geometry: draft.geometry, mode: draft.resizeMode })
    if (!success) restore()
    else { guides.value = []; running = null }
  })
  onDomEvent<KeyboardEvent>(window, 'keydown', (event) => {
    if (event.key !== 'Escape' || !running) return
    event.preventDefault(); restore()
  })
  return { guides,
    startMove: (event: PointerEvent) => start(event, { kind: 'move' }),
    startResize: (event: PointerEvent, handle: Handle) => start(event, { kind: 'resize', handle }),
    startRotate: (event: PointerEvent) => start(event, { kind: 'rotate' }) }
}
