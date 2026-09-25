<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { activeText, beginStudioTextEdit, endStudioTextEdit, restoreStudioTextSelection, studioTextCommand, textBusy, textError, textSelection } from '../studiotext-editor'
import { slideElement } from '../dom'

const color = ref('#ff3344')
const size = ref(72)
const selected = computed(() => textSelection.value.mode === 'textRange')
watch(activeText, (state) => {
  if (!state?.document) return
  color.value = /^#[0-9a-fA-F]{6}$/.test(state.document.defaults.color) ? state.document.defaults.color : '#ff3344'
  size.value = state.document.defaults.fontSize
})
async function reload() {
  const state = activeText.value
  if (!state) return
  const host = slideElement(state.no)?.querySelector<HTMLElement>(`[data-studio-text-id="${CSS.escape(state.id)}"]`)
  if (host) await beginStudioTextEdit(host, state.no)
}
</script>

<template>
  <div v-if="activeText" class="studio-text-controls" data-testid="studio-text-controls">
    <strong>StudioText {{ activeText.id }}</strong>
    <button type="button" aria-label="Close text edit" @click="endStudioTextEdit">×</button>
    <p v-if="activeText.reason" class="studio-hint">Visual editing unavailable: {{ activeText.reason }}</p>
    <p v-else-if="activeText.stale" class="studio-hint">Source changed outside this editor. Reload this text before editing.</p>
    <template v-else>
      <p class="studio-hint">{{ selected ? 'Text range selected' : 'Select a word or range on the slide.' }} To change the words, edit the Markdown.</p>
      <label>Color <input v-model="color" aria-label="Text color" type="color" :disabled="!selected || textBusy" @change="studioTextCommand('format', 'color', color)" /></label>
      <label>Size <input v-model.number="size" aria-label="Text size" type="number" min="1" step="1" :disabled="!selected || textBusy" @change="studioTextCommand('format', 'fontSize', size)" /></label>
      <button type="button" :disabled="!activeText.canUndo || textBusy" @mousedown.prevent @click="studioTextCommand('undo')">Undo text</button>
      <button type="button" :disabled="!activeText.canRedo || textBusy" @mousedown.prevent @click="studioTextCommand('redo')">Redo text</button>
      <button type="button" :disabled="!selected" @mousedown.prevent @click="restoreStudioTextSelection">Restore selection</button>
    </template>
    <button v-if="activeText.stale" type="button" @click="reload">Reload text</button>
    <p v-if="textError" class="studio-hint" role="alert">{{ textError }}</p>
  </div>
</template>
