<script setup lang="ts">
import { computed, inject } from 'vue'
import { studioDecorationKey } from './studio-decoration'
import { cssFontSettings } from './font-settings'
const props = defineProps<{
  fontFamily?: string
  fontSize?: number | string
  fontWeight?: number | string
  fontStyle?: string
  color?: string
  lineHeight?: number | string
  letterSpacing?: number | string
  decoration?: string
  textCase?: string
  link?: string
  fontAxes?: string
  openType?: string
}>()
const inheritedDecoration = inject(studioDecorationKey, computed(() => 'none'))
const style = computed(() => ({
  fontFamily: props.fontFamily,
  fontSize: props.fontSize == null ? undefined : `${props.fontSize}px`,
  fontWeight: props.fontWeight,
  fontStyle: props.fontStyle,
  color: props.color,
  lineHeight: props.lineHeight,
  letterSpacing: props.letterSpacing,
  textDecorationLine: props.decoration ?? inheritedDecoration.value,
  textTransform: props.textCase,
  fontVariationSettings: cssFontSettings(props.fontAxes, 'axis'),
  fontFeatureSettings: cssFontSettings(props.openType, 'feature'),
}))
</script>

<template>
  <a v-if="link" class="studio-text-run" :style="style" :href="link"
    :target="/^https?:/.test(link) ? '_blank' : undefined" :rel="/^https?:/.test(link) ? 'noopener noreferrer' : undefined"
    @click="($event.currentTarget as HTMLElement).closest('[contenteditable=true]') && $event.preventDefault()"><slot /></a>
  <span v-else class="studio-text-run" :style="style"><slot /></span>
</template>
