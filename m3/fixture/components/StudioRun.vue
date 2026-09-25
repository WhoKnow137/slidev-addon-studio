<script setup lang="ts">
import { computed, inject } from 'vue'
import { studioDecorationKey } from './studio-decoration'
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
}))
</script>

<template>
  <span class="studio-text-run" :style="style"><slot /></span>
</template>
