<script setup lang="ts">
import type { EditableCharacterProperty, ParagraphStyle } from '../../shared/studiotext'
import type { TypographyEdit } from '../../shared/typography'
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { resolveCharacterProperty, resolveParagraphAlignment, resolveParagraphProperty, resolveTagValue, resolveToggle, resolveVerticalAlignment } from '../../shared/typography'
import { activeText, beginStudioTextEdit, commitTypographyPreview, previewStudioTextRange, refreshStudioText, studioStyleCommand, studioTextCommand, studioTypographyCommand, textBusy, textError, textSelection } from '../studiotext-editor'
import { fontCatalog, waitForFont } from '../font-catalog'
import { findFont } from '../../shared/font-catalog'
import FontPicker from './FontPicker.vue'
import { loadTextStyles, textStyleCommand, textStyleError, textStyleState } from '../text-styles'
import type { CharacterStyle } from '../../shared/studiotext'
import { slideElement } from '../dom'

const document = computed(() => activeText.value?.stale ? null : activeText.value?.document ?? null)
const reason = computed(() => activeText.value?.stale ? 'Source changed outside this editor. Reload before editing.'
  : activeText.value?.reason ?? textError.value ?? 'Select one managed StudioText object.')
const scope = computed(() => textSelection.value.mode === 'objects' ? 'Whole text object'
  : textSelection.value.mode === 'textCaret' ? 'Caret typing style' : 'Selected text range')
const character = (key: EditableCharacterProperty) => resolveCharacterProperty(document.value, textSelection.value, key, reason.value)
const toggle = (key: 'bold' | 'italic' | 'underline' | 'strikethrough') =>
  resolveToggle(document.value, textSelection.value, key, reason.value)
const horizontal = computed(() => resolveParagraphAlignment(document.value, textSelection.value, reason.value))
const vertical = computed(() => resolveVerticalAlignment(document.value, textSelection.value, reason.value))
const family = computed(() => character('fontFamily'))
const selectedFont = computed(() => family.value.state === 'value' ? findFont(fontCatalog.value, family.value.value) : undefined)
const paragraph = (key: keyof ParagraphStyle) => resolveParagraphProperty(document.value, textSelection.value, key, reason.value)
const paragraphValue = (key: keyof ParagraphStyle) => {
  const state = paragraph(key)
  return state.state === 'value' && state.value !== undefined ? String(state.value) : ''
}
const tagValue = (key: 'fontAxes' | 'openType', tag: string) => resolveTagValue(document.value, textSelection.value, key, tag, reason.value)
const linkValue = computed(() => {
  const state = resolveCharacterProperty(document.value, textSelection.value, 'link', reason.value)
  return state.state === 'value' ? state.value ?? '' : ''
})
const linkDraft = ref('')
const newStyleName = ref('')
const styleToApply = ref('')
const currentStyle = computed(() => textStyleState.value.file.styles.find(item => item.id === document.value?.styleRef))
const overrideCount = computed(() => Object.keys(document.value?.localDefaults ?? {}).length
  + (document.value?.localParagraphs ?? []).reduce((total, paragraph) => total + Object.keys(paragraph).length, 0))
onMounted(() => { void loadTextStyles() })
async function createStyle() {
  const doc = document.value
  const name = newStyleName.value.trim()
  if (!doc || !name) return
  const base = name.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'style'
  let id = base; let index = 2
  while (textStyleState.value.file.styles.some(item => item.id === id)) id = `${base}-${index++}`
  const ok = await textStyleCommand('upsert', { id, name, character: { ...doc.defaults },
    paragraph: { ...doc.paragraphs[0]?.properties } })
  if (ok) { styleToApply.value = id; newStyleName.value = '' }
}
async function updateStyleCharacter(key: keyof CharacterStyle, value: unknown) {
  const style = currentStyle.value
  if (!style) return
  const ok = await textStyleCommand('upsert', { ...style, character: { ...style.character, [key]: value } })
  if (ok) await refreshStudioText()
}
async function applySelectedStyle() {
  if (styleToApply.value) await studioStyleCommand({ kind: 'apply', id: styleToApply.value })
}
watch(linkValue, value => { linkDraft.value = value }, { immediate: true })
let previewHost: HTMLElement | null = null
let previewFamily = ''
let previewAxes = ''
let clearRangePreview: (() => void) | null = null
let previewGuard: { id: string, revision: string, selection: typeof textSelection.value } | null = null
function clearPreview() {
  clearRangePreview?.()
  clearRangePreview = null
  if (previewHost) {
    previewHost.style.fontFamily = previewFamily
    previewHost.style.fontVariationSettings = previewAxes
  }
  previewHost = null
  previewGuard = null
}
onBeforeUnmount(clearPreview)
watch(() => [activeText.value?.id, activeText.value?.revision, activeText.value?.stale], clearPreview)
function previewFont(candidate: string | null) {
  clearPreview()
  if (!candidate) return
  const state = activeText.value
  const host = state && slideElement(state.no)?.querySelector<HTMLElement>(`[data-studio-text-id="${CSS.escape(state.id)}"]`)
  if (!host) return
  previewHost = host
  previewFamily = host.style.fontFamily
  previewAxes = host.style.fontVariationSettings
  const selection = textSelection.value
  void waitForFont(candidate).then(() => {
    if (previewHost !== host || textSelection.value !== selection) return
    clearRangePreview = previewStudioTextRange('fontFamily', candidate)
    if (!clearRangePreview) host.style.fontFamily = candidate
  })
}
async function chooseFont(value: string) {
  clearPreview()
  if (!value.trim()) return
  await waitForFont(value)
  await studioTypographyCommand({ domain: 'character', property: 'fontFamily', value })
}
function previewAxis(tag: string, value: number) {
  const state = activeText.value
  const host = state && slideElement(state.no)?.querySelector<HTMLElement>(`[data-studio-text-id="${CSS.escape(state.id)}"]`)
  if (!host) return
  if (previewHost !== host) {
    clearPreview(); previewHost = host; previewFamily = host.style.fontFamily; previewAxes = host.style.fontVariationSettings
    previewGuard = { id: state!.id, revision: state!.revision, selection: structuredClone(textSelection.value) }
  }
  const axes = textSelection.value.mode === 'objects' ? { ...document.value?.defaults.fontAxes, [tag]: value } : { [tag]: value }
  const settings = Object.entries(axes).sort(([a], [b]) => a.localeCompare(b)).map(([name, number]) => `"${name}" ${number}`).join(', ')
  clearRangePreview?.()
  clearRangePreview = previewStudioTextRange('fontVariationSettings', settings)
  if (!clearRangePreview) host.style.fontVariationSettings = settings
}
function commitAxis(tag: string, value: number) {
  const guard = previewGuard
  clearPreview()
  if (guard) void commitTypographyPreview({ domain: 'axis', tag, value }, guard.id, guard.revision, guard.selection)
}
function commitParagraph(key: 'spacingBefore' | 'spacingAfter' | 'indent' | 'firstLineIndent', event: Event) {
  commit({ domain: 'paragraph', property: key, value: Number((event.target as HTMLInputElement).value) })
}
function commitLink() { commit({ domain: 'link', value: linkDraft.value.trim() || null }) }
function commitList(kind: 'bullet' | 'ordered' | 'none') {
  commit({ domain: 'list-kind', value: kind })
}
const display = (key: EditableCharacterProperty) => {
  const state = character(key)
  return state.state === 'value' ? String(state.value) : ''
}
const hint = (key: EditableCharacterProperty) => {
  const state = character(key)
  return state.state === 'mixed' ? 'Mixed' : state.state === 'unavailable' ? state.reason : ''
}
const disabled = (key: EditableCharacterProperty) => textBusy.value || character(key).state === 'unavailable'
const optionValue = (state: ReturnType<typeof resolveParagraphAlignment>) =>
  state.state === 'value' ? state.value : ''
const tooltip = (state: { state: string, reason?: string }) => state.state === 'unavailable' ? state.reason : ''
function commitCharacter(key: EditableCharacterProperty, event: Event) {
  const input = event.target as HTMLInputElement
  const value = key === 'fontSize' || key === 'fontWeight' ? Number(input.value) : input.value
  void studioTypographyCommand({ domain: 'character', property: key, value })
}
function commit(edit: TypographyEdit) { void studioTypographyCommand(edit) }
async function reload() {
  const state = activeText.value
  if (!state) return
  const host = slideElement(state.no)?.querySelector<HTMLElement>(`[data-studio-text-id="${CSS.escape(state.id)}"]`)
  if (host) await beginStudioTextEdit(host, state.no)
}
</script>

<template>
  <section class="studio-section studio-typography" data-testid="typography-inspector">
    <h3 class="studio-section__title">Typography</h3>
    <p class="studio-hint">{{ scope }} · {{ activeText?.id ?? 'No managed text' }}</p>
    <p v-if="!document" class="studio-hint" role="status">{{ reason }}</p>
    <button v-if="activeText?.stale" type="button" class="studio-button" @click="reload">Reload text</button>
    <button v-else-if="document && !activeText?.editing" type="button" class="studio-button" @mousedown.prevent @click="reload">Edit text</button>

    <div class="studio-type-field">Shared text style
      <p v-if="currentStyle" class="studio-hint">{{ currentStyle.name }} · {{ overrideCount }} local overrides</p>
      <select aria-label="Shared text style" v-model="styleToApply" :disabled="!document || textBusy">
        <option value="">Choose style</option>
        <option v-for="style in textStyleState.file.styles" :key="style.id" :value="style.id">{{ style.name }}</option>
      </select>
      <span class="studio-button-row">
        <button type="button" class="studio-button" :disabled="!styleToApply || textSelection.mode !== 'objects' || textBusy"
          @mousedown.prevent @click="applySelectedStyle">Apply style</button>
        <button type="button" class="studio-button" :disabled="!document?.styleRef || textSelection.mode !== 'objects' || textBusy"
          @mousedown.prevent @click="studioStyleCommand({ kind: 'detach' })">Detach style</button>
      </span>
      <label>Create style from current text
        <input aria-label="New text style name" v-model="newStyleName" :disabled="!document" @keydown.enter.prevent="createStyle" />
      </label>
      <button type="button" class="studio-button" :disabled="!document || !newStyleName.trim()" @mousedown.prevent @click="createStyle">Create style</button>
      <div v-if="currentStyle" class="studio-type-grid">
        <label class="studio-type-field">Style font
          <input aria-label="Style font family" :value="currentStyle.character.fontFamily ?? ''"
            @change="updateStyleCharacter('fontFamily', ($event.target as HTMLInputElement).value)" />
        </label>
        <label class="studio-type-field">Style size
          <input aria-label="Style font size" type="number" min="0.01" :value="currentStyle.character.fontSize ?? ''"
            @change="updateStyleCharacter('fontSize', Number(($event.target as HTMLInputElement).value))" />
        </label>
        <label class="studio-type-field">Style weight
          <input aria-label="Style font weight" type="number" min="1" max="1000" :value="currentStyle.character.fontWeight ?? ''"
            @change="updateStyleCharacter('fontWeight', Number(($event.target as HTMLInputElement).value))" />
        </label>
        <label class="studio-type-field">Style color
          <input aria-label="Style color" :value="currentStyle.character.color ?? ''"
            @change="updateStyleCharacter('color', ($event.target as HTMLInputElement).value)" />
        </label>
      </div>
      <span class="studio-button-row">
        <button type="button" class="studio-button" :disabled="!textStyleState.canUndo" @mousedown.prevent @click="textStyleCommand('undo').then(refreshStudioText)">Undo style</button>
        <button type="button" class="studio-button" :disabled="!textStyleState.canRedo" @mousedown.prevent @click="textStyleCommand('redo').then(refreshStudioText)">Redo style</button>
      </span>
      <p v-if="textStyleError" role="alert" class="studio-hint">{{ textStyleError }}</p>
    </div>

    <FontPicker :family="display('fontFamily')" :mixed="family.state === 'mixed'" :disabled="disabled('fontFamily')"
      @preview="previewFont" @select="chooseFont" />
    <label v-if="selectedFont?.styles.length" class="studio-type-field">Available face
      <select aria-label="Available font face" :value="display('fontWeight') + '/' + display('fontStyle')"
        :disabled="textBusy" @change="commit({ domain: 'face', weight: Number(($event.target as HTMLSelectElement).value.split('/')[0]), style: ($event.target as HTMLSelectElement).value.split('/')[1] as any })">
        <option v-for="face in selectedFont.styles" :key="face.weight + '/' + face.style" :value="face.weight + '/' + face.style">
          {{ face.style }} {{ face.weight }}
        </option>
      </select>
    </label>
    <div class="studio-type-grid">
      <label class="studio-type-field">Weight
        <input aria-label="Font weight" type="number" min="1" max="1000" step="100" :value="display('fontWeight')"
          :placeholder="hint('fontWeight')" :title="hint('fontWeight')" :disabled="disabled('fontWeight')"
          @change="commitCharacter('fontWeight', $event)" />
      </label>
      <label class="studio-type-field">Style
        <select aria-label="Font style" :value="display('fontStyle')" :title="hint('fontStyle')"
          :disabled="disabled('fontStyle')" @change="commitCharacter('fontStyle', $event)">
          <option value="" disabled>{{ hint('fontStyle') || 'Choose style' }}</option>
          <option value="normal">Normal</option><option value="italic">Italic</option><option value="oblique">Oblique</option>
        </select>
      </label>
      <label class="studio-type-field">Size (px)
        <input aria-label="Font size" type="number" min="0.01" step="0.1" :value="display('fontSize')"
          :placeholder="hint('fontSize')" :title="hint('fontSize')" :disabled="disabled('fontSize')"
          @change="commitCharacter('fontSize', $event)" />
      </label>
      <label class="studio-type-field">Line height
        <input aria-label="Line height" type="text" :value="display('lineHeight')" :placeholder="hint('lineHeight')"
          :title="hint('lineHeight')" :disabled="disabled('lineHeight')" @change="commitCharacter('lineHeight', $event)" />
      </label>
      <label class="studio-type-field">Letter spacing
        <input aria-label="Letter spacing" type="text" :value="display('letterSpacing')" :placeholder="hint('letterSpacing')"
          :title="hint('letterSpacing')" :disabled="disabled('letterSpacing')" @change="commitCharacter('letterSpacing', $event)" />
      </label>
    </div>

    <label class="studio-type-field">Color
      <span class="studio-type-color">
        <input aria-label="Color swatch" type="color" :value="display('color').slice(0, 7) || '#ffffff'"
          :disabled="disabled('color')" @change="commitCharacter('color', $event)" />
        <input aria-label="Text color hex" type="text" :value="display('color')" :placeholder="hint('color')"
          :title="hint('color')" :disabled="disabled('color')" @change="commitCharacter('color', $event)" />
      </span>
    </label>

    <div class="studio-type-field">Formatting
      <div class="studio-button-row">
        <button v-for="item in ([['bold','B'],['italic','I'],['underline','U'],['strikethrough','S']] as const)"
          :key="item[0]" type="button" class="studio-button" :aria-label="item[0]"
          :aria-pressed="toggle(item[0]).state === 'value' && toggle(item[0]).value"
          :title="tooltip(toggle(item[0]))" :disabled="textBusy || toggle(item[0]).state === 'unavailable'"
          @mousedown.prevent @click="commit({ domain: 'toggle', property: item[0] })">{{ item[1] }}</button>
      </div>
    </div>
    <label class="studio-type-field">Horizontal alignment
      <select aria-label="Horizontal alignment" :value="optionValue(horizontal)" :title="tooltip(horizontal)"
        :disabled="textBusy || horizontal.state === 'unavailable'"
        @change="commit({ domain: 'paragraph', property: 'align', value: ($event.target as HTMLSelectElement).value as any })">
        <option value="" disabled>{{ horizontal.state === 'mixed' ? 'Mixed' : 'Choose alignment' }}</option>
        <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option><option value="justify">Justify</option>
      </select>
    </label>
    <label class="studio-type-field">Vertical alignment <small>(whole object)</small>
      <select aria-label="Vertical alignment" :value="optionValue(vertical)" :title="tooltip(vertical)"
        :disabled="textBusy || vertical.state === 'unavailable'"
        @change="commit({ domain: 'object', property: 'verticalAlign', value: ($event.target as HTMLSelectElement).value as any })">
        <option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option>
      </select>
    </label>
    <label class="studio-type-field">Case
      <select aria-label="Text case" :value="display('textCase')" :title="hint('textCase')"
        :disabled="disabled('textCase')" @change="commitCharacter('textCase', $event)">
        <option value="" disabled>{{ hint('textCase') || 'Choose case' }}</option>
        <option value="none">Original</option><option value="uppercase">Uppercase</option>
        <option value="lowercase">Lowercase</option><option value="capitalize">Capitalize</option>
      </select>
    </label>
    <div v-if="selectedFont?.variableAxes.length" class="studio-type-field">Variable axes
      <label v-for="axis in selectedFont.variableAxes" :key="axis.tag" class="studio-type-field">
        {{ axis.name }} ({{ axis.tag }})
        <input :aria-label="axis.name + ' axis'" type="range" :min="axis.min" :max="axis.max" :step="axis.step ?? 'any'"
          :value="tagValue('fontAxes', axis.tag).state === 'value' ? tagValue('fontAxes', axis.tag).value ?? axis.default : axis.default"
          :disabled="textBusy" @input="previewAxis(axis.tag, Number(($event.target as HTMLInputElement).value))"
          @change="commitAxis(axis.tag, Number(($event.target as HTMLInputElement).value))" />
        <span>{{ tagValue('fontAxes', axis.tag).state === 'mixed' ? 'Mixed' : tagValue('fontAxes', axis.tag).state === 'value' ? tagValue('fontAxes', axis.tag).value ?? axis.default : axis.default }}</span>
      </label>
    </div>
    <div v-if="selectedFont?.openTypeFeatures.length" class="studio-type-field">OpenType features
      <label v-for="feature in selectedFont.openTypeFeatures" :key="feature.tag" class="studio-type-field">
        <input :aria-label="feature.name" type="checkbox" :disabled="textBusy"
          :checked="tagValue('openType', feature.tag).state === 'value' && !!tagValue('openType', feature.tag).value"
          @change="commit({ domain: 'feature', tag: feature.tag, value: ($event.target as HTMLInputElement).checked })" />
        {{ feature.name }} ({{ feature.tag }})
      </label>
    </div>
    <div class="studio-type-grid">
      <label v-for="field in ([['spacingBefore','Spacing before'],['spacingAfter','Spacing after'],['indent','Paragraph indent'],['firstLineIndent','First-line indent']] as const)"
        :key="field[0]" class="studio-type-field">{{ field[1] }} (px)
        <input :aria-label="field[1]" type="number" :min="field[0].startsWith('spacing') ? 0 : undefined" step="0.1"
          :value="paragraphValue(field[0])" :placeholder="paragraph(field[0]).state === 'mixed' ? 'Mixed' : '0'"
          :disabled="textBusy || paragraph(field[0]).state === 'unavailable'" @change="commitParagraph(field[0], $event)" />
      </label>
    </div>
    <label class="studio-type-field">List
      <select aria-label="List kind" :disabled="textBusy || paragraph('list').state === 'unavailable'"
        :value="paragraph('list').state === 'value' ? paragraph('list').value?.kind ?? 'none' : ''"
        @change="commitList(($event.target as HTMLSelectElement).value as any)">
        <option value="" disabled>Mixed</option><option value="none">None</option>
        <option value="bullet">Bullet</option><option value="ordered">Numbered</option>
      </select>
    </label>
    <label class="studio-type-field">List level
      <input aria-label="List level" type="number" min="0" max="12" step="1"
        :value="paragraph('list').state === 'value' ? paragraph('list').value?.level ?? 0 : ''"
        :disabled="textBusy || paragraph('list').state !== 'value' || !paragraph('list').value"
        @change="commit({ domain: 'paragraph', property: 'list', value: { kind: paragraph('list').value!.kind, level: Number(($event.target as HTMLInputElement).value) } })" />
    </label>
    <label class="studio-type-field">Text direction
      <select aria-label="Text direction" :value="paragraphValue('direction') || 'auto'"
        :disabled="textBusy || paragraph('direction').state === 'unavailable'"
        @change="commit({ domain: 'paragraph', property: 'direction', value: ($event.target as HTMLSelectElement).value as any })">
        <option value="auto">Auto</option><option value="ltr">Left to right</option><option value="rtl">Right to left</option>
      </select>
    </label>
    <label class="studio-type-field">Link <small>(selected range)</small>
      <input aria-label="Link URL" type="url" v-model="linkDraft" :placeholder="resolveCharacterProperty(document, textSelection, 'link').state === 'mixed' ? 'Mixed' : 'https://example.com'"
        :disabled="textBusy || textSelection.mode === 'objects'" @keydown.enter.prevent="commitLink" />
      <span class="studio-button-row">
        <button type="button" class="studio-button" :disabled="textBusy || textSelection.mode === 'objects'" @mousedown.prevent @click="commitLink">Apply link</button>
        <button type="button" class="studio-button" :disabled="textBusy || textSelection.mode === 'objects'" @mousedown.prevent @click="commit({ domain: 'link', value: null })">Remove link</button>
      </span>
    </label>
    <div class="studio-button-row">
      <button type="button" class="studio-button" aria-label="Undo text" :disabled="!activeText?.canUndo || textBusy" @mousedown.prevent @click="studioTextCommand('undo')">Undo text</button>
      <button type="button" class="studio-button" aria-label="Redo text" :disabled="!activeText?.canRedo || textBusy" @mousedown.prevent @click="studioTextCommand('redo')">Redo text</button>
    </div>
    <p v-if="textError" class="studio-hint" role="alert">{{ textError }}</p>
  </section>
</template>
