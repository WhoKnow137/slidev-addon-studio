<script setup lang="ts">
import type { GeometryEdit } from '../../shared/geometry'
import { computed, ref, watch } from 'vue'
import { geometryDisplay } from '../../shared/geometry'
import type { TextDocument } from '../../shared/studiotext'
import { activeText, studioGeometryBatchCommand, studioGeometryCommand, textBusy, textError, textSelection } from '../studiotext-editor'
import { measureStudioText } from '../studio-text-measurement'

const model = computed(() => activeText.value?.document)
const selectedIds = computed(() => textSelection.value.mode === 'objects' ? textSelection.value.ids : [])
const multiple = computed(() => selectedIds.value.length > 1)
const otherModels = ref<TextDocument[]>([])
const multiReason = ref('')
watch(() => [activeText.value?.revision, activeText.value?.no, selectedIds.value.join('|')], async () => {
  otherModels.value = []; multiReason.value = ''
  const state = activeText.value
  if (!state?.document || selectedIds.value.length < 2) return
  const ids = selectedIds.value.slice(1)
  try {
    const responses = await Promise.all(ids.map(id => fetch(`/@studio/text?no=${state.no}&id=${encodeURIComponent(id)}`)))
    const values = await Promise.all(responses.map(response => response.json()))
    if (responses.some(response => !response.ok) || values.some(value => !value.editable || value.handle.filePath !== state.handle.filePath))
      throw Error('Multi-object geometry requires supported text objects in the same source file.')
    otherModels.value = values.map(value => value.document)
  }
  catch (error) { multiReason.value = error instanceof Error ? error.message : String(error) }
}, { immediate: true })
const disabled = computed(() => textBusy.value || !model.value || !!model.value.geometry.affine || !!activeText.value?.stale
  || !!multiReason.value || (multiple.value && otherModels.value.length !== selectedIds.value.length - 1))
const measured = ref<{ width: number, height: number } | null>(null)
const scaleFactor = ref(2)
const message = computed(() => activeText.value?.stale ? 'Source changed. Reload before changing geometry.'
  : multiReason.value ? multiReason.value
  : model.value?.geometry.affine ? 'Arbitrary affine transform is preserved; geometry controls are read-only.'
    : !model.value ? activeText.value?.reason ?? 'Select a supported StudioText object.' : '')
async function measure() {
  const state = activeText.value
  if (!state?.document) throw Error('No managed text selected')
  const size = await measureStudioText(state.no, state.document)
  measured.value = size
  return size
}
async function commit(edit: GeometryEdit) {
  try {
    if (multiple.value) await studioGeometryBatchCommand(edit)
    else await studioGeometryCommand(edit)
    measured.value = null
  }
  catch (error) { textError.value = error instanceof Error ? error.message : String(error) }
}
async function dimension(property: 'width' | 'height', event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  try { await commit({ kind: 'set', property, value, measurement: await measure() }) }
  catch (error) { textError.value = error instanceof Error ? error.message : String(error) }
}
async function mode(event: Event) {
  try { await commit({ kind: 'mode', mode: (event.target as HTMLSelectElement).value as any,
    measurement: await measure() }) }
  catch (error) { textError.value = error instanceof Error ? error.message : String(error) }
}
async function scale() {
  try { await commit({ kind: 'scale', factor: scaleFactor.value, measurement: await measure() }) }
  catch (error) { textError.value = error instanceof Error ? error.message : String(error) }
}
const mixed = (property: 'x' | 'y') => multiple.value && model.value
  && otherModels.value.some(other => other.geometry[property] !== model.value?.geometry[property])
const number = (property: 'x' | 'y' | 'rotationDeg') =>
  model.value ? (property !== 'rotationDeg' && mixed(property) ? '' : geometryDisplay(model.value.geometry[property])) : ''
const sizeValue = (property: 'width' | 'height') => {
  const value = model.value?.geometry[property]
  return value == null ? '' : geometryDisplay(value)
}
</script>

<template>
  <section class="studio-section studio-geometry" data-testid="geometry-inspector">
    <h3 class="studio-section__title">Transform</h3>
    <p v-if="message" class="studio-hint" role="status">{{ message }}</p>
    <div class="studio-type-grid">
      <label v-for="item in ([['x','X'],['y','Y']] as const)" :key="item[0]" class="studio-type-field">{{ item[1] }}
        <input :aria-label="item[1]" type="number" step="1" :value="number(item[0])"
          :placeholder="mixed(item[0]) ? 'Mixed' : ''" :disabled="disabled"
          @change="commit({ kind: 'set', property: item[0], value: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label v-for="item in ([['width','W'],['height','H']] as const)" :key="item[0]" class="studio-type-field">{{ item[1] }}
        <input :aria-label="item[1]" type="number" min="0.01" step="1" :value="sizeValue(item[0])"
          :placeholder="model?.geometry[item[0]] == null ? 'Auto' : ''" :disabled="disabled || multiple"
          @change="dimension(item[0], $event)" />
      </label>
    </div>
    <label class="studio-type-field">Resize mode
      <select aria-label="Resize mode" :value="model?.resizeMode" :disabled="disabled || multiple" @change="mode($event)">
        <option value="auto-width">Auto Width</option><option value="auto-height">Auto Height</option><option value="fixed">Fixed Size</option>
      </select>
    </label>
    <label class="studio-type-field">Rotation (degrees)
      <input aria-label="Rotation" type="number" step="1" :value="number('rotationDeg')" :disabled="disabled || multiple"
        @change="commit({ kind: 'set', property: 'rotationDeg', value: Number(($event.target as HTMLInputElement).value) })" />
    </label>
    <label class="studio-type-field">Scale factor <small>(changes frame and typography)</small>
      <span class="studio-type-color">
        <input v-model.number="scaleFactor" aria-label="Scale factor" type="number" min="0.01" max="100" step="0.1" :disabled="disabled || multiple" />
        <button type="button" class="studio-button" aria-label="Scale text" :disabled="disabled || multiple" @click="scale">Scale</button>
      </span>
    </label>
    <p class="studio-hint">Drag the frame to move. Drag handles to resize. Shift snaps rotation to 15°. Hold Alt to disable snapping. Auto dimensions are source constraints; their rendered size is measured only for explicit transitions.</p>
  </section>
</template>
