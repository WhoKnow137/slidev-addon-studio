<script setup lang="ts">
import { computed, provide } from 'vue'
import { DecoratedContent, studioDecorationKey } from './studio-decoration'
const props = defineProps<{
  version: string
  id: string
  pos: string
  resize: 'auto-width' | 'auto-height' | 'fixed'
  maxWidth?: number | string
  affine?: string
  rotate?: number | string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number | string
  fontStyle?: string
  color?: string
  lineHeight?: number | string
  letterSpacing?: number | string
  decoration?: string
  textCase?: string
  align?: string
  verticalAlign?: string
  styleRef?: string
}>()
provide(studioDecorationKey, computed(() => props.decoration ?? 'none'))
const style = computed(() => {
  const [x, y, width, height] = props.pos.split(',')
  return {
    position: 'absolute' as const,
    display: props.resize === 'fixed' ? 'flex' : 'block',
    flexDirection: props.resize === 'fixed' ? 'column' as const : undefined,
    justifyContent: props.resize === 'fixed'
      ? props.verticalAlign === 'bottom' ? 'flex-end' : props.verticalAlign === 'center' ? 'center' : 'flex-start'
      : undefined,
    left: `${x}px`, top: `${y}px`,
    width: width === 'auto' ? 'max-content' : `${width}px`,
    height: height === 'auto' ? 'auto' : `${height}px`,
    maxWidth: props.maxWidth == null ? undefined : `${props.maxWidth}px`,
    overflow: 'visible' as const,
    transform: `${props.affine ? `matrix(${props.affine}) ` : ''}rotate(${Number(props.rotate ?? 0)}deg)`,
    fontFamily: props.fontFamily ?? 'sans-serif',
    fontSize: `${props.fontSize ?? 32}px`,
    fontWeight: props.fontWeight,
    fontStyle: props.fontStyle,
    color: props.color ?? '#ffffff',
    lineHeight: props.lineHeight ?? 'normal',
    letterSpacing: props.letterSpacing,
    textTransform: props.textCase ?? 'none',
    textAlign: props.align as any,
    whiteSpace: props.resize === 'auto-width' && props.maxWidth == null ? 'pre' as const : 'pre-wrap' as const,
  }
})
</script>

<template>
  <div class="studio-text-v1" :data-studio-text-id="id" :data-studio-text-version="version" :data-studio-text-pos="pos" :data-resize="resize" :style="style"><div class="studio-text-content"><DecoratedContent :decoration="decoration ?? 'none'"><slot /></DecoratedContent></div></div>
</template>
