<script setup lang="ts">
import type { EditableCharacterProperty } from '../../shared/studiotext'
import type { TypographyEdit } from '../../shared/typography'
import { computed } from 'vue'
import { resolveCharacterProperty, resolveParagraphAlignment, resolveToggle, resolveVerticalAlignment } from '../../shared/typography'
import { activeText, beginStudioTextEdit, studioTextCommand, studioTypographyCommand, textBusy, textError, textSelection } from '../studiotext-editor'
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

    <label class="studio-type-field">Font
      <input aria-label="Font family" type="text" :value="display('fontFamily')" :placeholder="hint('fontFamily')"
        :title="hint('fontFamily')" :disabled="disabled('fontFamily')" @change="commitCharacter('fontFamily', $event)" />
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
    <div class="studio-button-row">
      <button type="button" class="studio-button" aria-label="Undo text" :disabled="!activeText?.canUndo || textBusy" @mousedown.prevent @click="studioTextCommand('undo')">Undo text</button>
      <button type="button" class="studio-button" aria-label="Redo text" :disabled="!activeText?.canRedo || textBusy" @mousedown.prevent @click="studioTextCommand('redo')">Redo text</button>
    </div>
    <p v-if="textError" class="studio-hint" role="alert">{{ textError }}</p>
  </section>
</template>
