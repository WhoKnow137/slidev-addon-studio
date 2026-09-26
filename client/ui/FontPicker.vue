<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { discoverSystemFonts, fontCatalog, fontCatalogError, fontLoadState, fontStatus, loadFontCatalog } from '../font-catalog'

const props = defineProps<{ family: string, mixed?: boolean, disabled?: boolean }>()
const emit = defineEmits<{ select: [family: string], preview: [family: string | null] }>()
const open = ref(false)
const query = ref('')
const active = ref(0)
const candidates = computed(() => {
  const list = [...fontCatalog.value.fonts]
  if (props.family && fontStatus(props.family) === 'missing') list.push({ family: props.family, source: 'missing' as const,
    styles: [], variableAxes: [], openTypeFeatures: [], metadataSource: 'unresolved' })
  return list.filter(item => item.family.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()))
})
const groups = computed(() => {
  const order = ['project', 'web', 'system', 'missing'] as const
  return order.map(source => ({ source, items: candidates.value.filter(item => item.source === source) })).filter(group => group.items.length)
})
watch(query, () => { active.value = 0 })
onMounted(() => { void loadFontCatalog() })
function close() { open.value = false; emit('preview', null) }
function preview(family: string) { emit('preview', family) }
function choose(family: string) { close(); emit('select', family) }
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); close(); return }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    active.value = Math.max(0, Math.min(candidates.value.length - 1, active.value + (event.key === 'ArrowDown' ? 1 : -1)))
    preview(candidates.value[active.value]?.family ?? '')
  }
  if (event.key === 'Enter' && candidates.value[active.value]) {
    event.preventDefault(); choose(candidates.value[active.value].family)
  }
}
async function scanSystem() {
  try { await discoverSystemFonts() }
  catch (error) { alert(error instanceof Error ? error.message : String(error)) }
}
</script>

<template>
  <div class="studio-font-picker" @keydown="keydown">
    <label class="studio-type-field">Font
      <input aria-label="Font family" type="text" :value="family" :placeholder="mixed ? 'Mixed' : 'Font family'"
        :disabled="disabled" @focus="open = true" @input="query = ($event.target as HTMLInputElement).value; open = true"
        @change="choose(($event.target as HTMLInputElement).value)" />
    </label>
    <p v-if="family && fontStatus(family) === 'missing'" role="status" class="studio-hint">⚠ Missing: {{ family }}</p>
    <p v-else-if="['failed', 'unavailable'].includes(fontLoadState[family.toLocaleLowerCase()] ?? '')" role="status" class="studio-hint">⚠ Font unavailable: {{ family }}. Requested family is preserved.</p>
    <div v-if="open" class="studio-font-picker__menu" role="listbox" aria-label="Fonts">
      <input aria-label="Search fonts" type="search" v-model="query" placeholder="Search fonts" @input="active = 0" />
      <p v-if="fontCatalogError" class="studio-hint">{{ fontCatalogError }}</p>
      <template v-for="group in groups" :key="group.source">
        <strong>{{ group.source === 'project' ? 'In this deck / Project fonts' : group.source === 'web' ? 'Web fonts' : group.source === 'system' ? 'System fonts' : 'Missing' }}</strong>
        <button v-for="font in group.items" :key="font.family" type="button" role="option"
          :aria-selected="font.family.toLocaleLowerCase() === family.toLocaleLowerCase()" :class="{ active: candidates[active]?.family === font.family }"
          :style="{ fontFamily: font.family }" @mouseenter="preview(font.family)" @focus="preview(font.family)"
          @mousedown.prevent @click="choose(font.family)">{{ font.family }} <small>Ag 123</small></button>
      </template>
      <button type="button" @mousedown.prevent @click="scanSystem">Discover system fonts</button>
      <button type="button" @mousedown.prevent @click="close">Cancel</button>
    </div>
  </div>
</template>

<style scoped>
.studio-font-picker { position: relative; }
.studio-font-picker__menu { position: relative; z-index: 10; max-height: 290px; overflow: auto; display: grid; gap: 3px; background: #202027; border: 1px solid #555; padding: 6px; }
.studio-font-picker__menu button { text-align: start; border: 0; padding: 5px; color: white; background: transparent; cursor: pointer; }
.studio-font-picker__menu button.active, .studio-font-picker__menu button:hover { background: #484858; }
.studio-font-picker__menu strong { margin-top: 5px; text-transform: capitalize; font-size: 11px; }
</style>
