<script setup lang="ts">
import type { StudioContext } from '../context'
import { useNav } from '@slidev/client'
import { useWindowSize } from '@vueuse/core'
import { computed, onScopeDispose, provide, watch, watchEffect } from 'vue'
import { activeText, endStudioTextEdit, installStudioTextSelection, studioGeometryBatchCommand, studioGeometryCommand, textSelection } from '../studiotext-editor'
import { duplicateBlock, nudgeBlock } from '../actions'
import { onDomEvent } from '../composables/useDomEvent'
import { useSelection } from '../composables/useSelection'
import { useSlideCanvas } from '../composables/useSlideCanvas'
import { useSlideSource } from '../composables/useSlideSource'
import { useTransformGizmo } from '../composables/useTransformGizmo'
import { useTextGeometryGizmo } from '../composables/useTextGeometryGizmo'
import { useLayerGeometryGizmo } from '../composables/useLayerGeometryGizmo'
import {activeLayer,clearLayers,installLayerKeys,layerHost,refreshLayers,sourceHistory} from '../managed-layer-editor'
import { studioContext, studioKey } from '../context'
import { dockWidth, editing, lastError, reportError, selection, studioOpen } from '../state'
import InlineEditor from './InlineEditor.vue'
import SelectionLayer from './SelectionLayer.vue'
import StudioDock from './StudioDock.vue'
import StudioToolbar from './StudioToolbar.vue'
import '../../styles/studio.css'

/**
 * The editor shell.
 *
 * Mounted from `global-top.vue`, which means it lives outside the slide's own
 * component tree: it can watch and rewrite the deck without any of its state
 * ending up in an exported slide.
 */
const nav = useNav()
const uninstallTextSelection = installStudioTextSelection()
const uninstallLayerKeys = installLayerKeys()
onScopeDispose(uninstallLayerKeys)
onScopeDispose(uninstallTextSelection)
const no = computed(() => nav.currentSlideNo.value)

const source = useSlideSource(no)
const canvas = useSlideCanvas(() => Number(source.frontmatter.value.zoom ?? 1))
async function commit(content: string, label: string, options?: { skipHmr?: boolean, keepSelection?: boolean }) {
  const current = selection.value
  if (current?.el.closest('[data-studio-text-id],[data-studio-object-id],[data-studio-render-only]')) {
    reportError(new Error('Managed/render-only source cannot use generic editing controls. Use its guarded controls or the Slidev source editor.'))
    return
  }
  await source.setContent(content, label, options)

  // Nothing re-rendered, so the element the user is holding is still the one on
  // screen. Re-finding it would only make the panel flicker.
  if (options?.keepSelection || !current)
    return

  await selectionApi.reselect(current.range, current.kind, current.tag)
}

const selectionApi = useSelection(
  () => no.value,
  () => source.content.value,
  // Deleting drops the selection outright, so there is nothing to restore.
  (next, label) => source.setContent(next, label),
)

const gizmo = useTransformGizmo({
  canvas,
  getTarget: () => selection.value,
  getContent: () => source.content.value,
  getNo: () => no.value,
  commit,
  selectThrough: (x, y) => selectionApi.selectThrough(x, y),
})
const textGizmo = useTextGeometryGizmo(canvas)
const layerGizmo = useLayerGeometryGizmo(canvas)
watch(() => [activeText.value?.revision,activeLayer.value?.revision], () => {void sourceHistory.refresh()})
watch(no,()=>clearLayers())
watch(()=>source.content.value,()=>{void refreshLayers()})
watchEffect(()=>{
  const layer=activeLayer.value
  if(!layer)return
  const host=layerHost(layer.no,layer.id)
  if(host&&selection.value?.el!==host)selection.value={el:host,no:layer.no,range:null,kind:'component',tag:'StudioLayer',positioned:true,nested:false,label:`${layer.document.kind} layer`}
})

const context: StudioContext = {
  no: () => no.value,
  content: () => source.content.value,
  frontmatter: () => source.frontmatter.value,
  note: () => source.note.value,
  canvas,
  gizmo,
  textGizmo,
  layerGizmo,
  commit,
  setFrontmatter: (values, label) => source.setFrontmatter(values, label),
  setNote: note => source.setNote(note),
  range: () => selection.value?.range ?? null,
  selectInserted: tag => selectionApi.selectInserted(tag),
  selectThrough: (x, y) => selectionApi.selectThrough(x, y),
  go: target => nav.go(target),
}

provide(studioKey, context)

// Also outside the component tree, for Slidev's setup files: the context menu
// is built there and has no way to inject.
studioContext.value = context
onScopeDispose(() => (studioContext.value = null))

/*
 * The keys a canvas is expected to answer to.
 *
 * Slidev owns the arrows for navigation and Studio has no business taking them
 * from a deck being presented. It takes them only when it has a positioned
 * block selected and nobody is typing, which is the one case where an arrow
 * plainly means "move this a bit", and hands them straight back otherwise.
 *
 * A tenth of the grid on its own, the whole step with Shift, matching what the
 * gizmo snaps to.
 */
const NUDGE = 1
const NUDGE_FAR = 10

onDomEvent<KeyboardEvent>(document, 'keydown', (event) => {
  if (!studioOpen.value || editing.value)
    return
  if(activeLayer.value)return
  if (activeText.value?.document && !activeText.value.editing && textSelection.value.mode === 'objects'
    && !activeText.value.stale && !activeText.value.document.geometry.affine) {
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
    const step = event.shiftKey ? 10 : 1
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step],
    }
    if (delta[event.key] && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      void (textSelection.value.ids.length > 1 ? studioGeometryBatchCommand : studioGeometryCommand)
        ({ kind: 'translate', dx: delta[event.key][0], dy: delta[event.key][1] })
      return
    }
  }
  const target = selection.value
  if (!target?.range)
    return
  // A key pressed in a panel field belongs to that field.
  if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]'))
    return

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'd') {
    event.preventDefault()
    duplicateBlock(context, target)
    return
  }

  const step = event.shiftKey ? NUDGE_FAR : NUDGE
  const by: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  }
  const delta = by[event.key]
  if (!delta || event.metaKey || event.ctrlKey || event.altKey)
    return

  // Decided here and not after the write: `preventDefault` has to happen while
  // the event is still being dispatched, and by the time an await came back
  // Slidev would already have changed slide.
  if (!target.positioned)
    return

  event.preventDefault()
  nudgeBlock(context, target, delta[0], delta[1])
}, { capture: true })

// Selection belongs to one slide; navigating away drops it.
watch(no, () => { selection.value = null; endStudioTextEdit() })
watch(studioOpen, open => { if (!open) {endStudioTextEdit();clearLayers()} })

// `useDynamicSlideInfo` fetches the slide source lazily, on first read. Touch
// it here so the source is already in hand when the user clicks, rather than
// the first click of every slide being the one that starts the request.
watchEffect(() => void source.info.value)

// Push the deck aside so the dock never covers what is being edited.
const viewport = useWindowSize()

watchEffect(() => {
  const root = document.documentElement
  root.classList.toggle('slidev-studio-docked', studioOpen.value)

  if (!studioOpen.value) {
    root.style.removeProperty('--studio-dock-width')
    root.style.removeProperty('--studio-deck-scale')
    root.style.removeProperty('--studio-deck-offset')
    return
  }

  const scale = Math.max(0.3, (viewport.width.value - dockWidth.value) / viewport.width.value)
  root.style.setProperty('--studio-dock-width', `${dockWidth.value}px`)
  root.style.setProperty('--studio-deck-scale', String(scale))
  root.style.setProperty('--studio-deck-offset', `${((1 - scale) * viewport.height.value) / 2}px`)
})

</script>

<template>
  <!--
    Teleported to `body` on purpose. Studio scales the deck down with a CSS
    transform to make room for the dock, and a transform makes its subtree the
    containing block for `position: fixed`. Left where Slidev mounts global
    layers, the editor's own chrome would be scaled and clipped along with the
    slide.
  -->
  <Teleport to="body">
    <div class="slidev-studio">
      <StudioToolbar />
      <template v-if="studioOpen">
        <SelectionLayer />
        <InlineEditor />
        <StudioDock />
      </template>
      <div v-if="lastError" class="studio-toast">
        {{ lastError }}
      </div>
    </div>
  </Teleport>
</template>
