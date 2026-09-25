<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{
  version: string
  id: string
  pos: string
  resize: 'auto-width' | 'auto-height' | 'fixed'
  rotate?: number
  fontFamily?: string
  fontSize?: number
  fontWeight?: number | string
  fontStyle?: string
  color?: string
  lineHeight?: number | string
  letterSpacing?: number | string
  align?: string
  verticalAlign?: string
  styleRef?: string
}>()
const style = computed(() => {
  const [x, y, width, height] = props.pos.split(',')
  return {
    position: 'absolute' as const,
    left: `${x}px`, top: `${y}px`,
    width: width === 'auto' ? 'max-content' : `${width}px`,
    height: height === 'auto' ? 'auto' : `${height}px`,
    transform: `rotate(${props.rotate ?? 0}deg)`,
    fontFamily: props.fontFamily ?? 'sans-serif',
    fontSize: `${props.fontSize ?? 32}px`,
    fontWeight: props.fontWeight,
    fontStyle: props.fontStyle,
    color: props.color ?? '#ffffff',
    lineHeight: props.lineHeight ?? 'normal',
    letterSpacing: props.letterSpacing,
    textAlign: props.align as any,
    verticalAlign: props.verticalAlign as any,
    whiteSpace: 'pre-wrap' as const,
  }
})
</script>

<template>
  <div class="studio-text-v1" :data-studio-text-id="id" :data-studio-text-version="version" :data-resize="resize" :style="style"><slot /></div>
</template>
