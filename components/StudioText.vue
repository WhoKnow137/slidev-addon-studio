<script setup lang="ts">
import { computed, onMounted, provide } from 'vue'
import { DecoratedContent, studioDecorationKey } from './studio-decoration'
import { cssFontSettings } from './font-settings'
import { loadRuntimeTextStyles, runtimeTextStyles, studioParagraphStyleKey } from './shared-text-styles'
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
  fontAxes?: string
  openType?: string
  align?: string
  verticalAlign?: string
  styleRef?: string
}>()
provide(studioDecorationKey, computed(() => props.decoration ?? shared.value?.character.decoration ?? 'none'))
onMounted(() => { if (props.styleRef) void loadRuntimeTextStyles() })
const shared = computed(() => runtimeTextStyles.value.styles.find(item => item.id === props.styleRef))
provide(studioParagraphStyleKey, computed(() => shared.value?.paragraph ?? {}))
const style = computed(() => {
  const [x, y, width, height] = props.pos.split(',')
  const inherited = shared.value?.character ?? {}
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
    fontFamily: props.fontFamily ?? inherited.fontFamily ?? 'sans-serif',
    fontSize: `${props.fontSize ?? inherited.fontSize ?? 32}px`,
    fontWeight: props.fontWeight ?? inherited.fontWeight,
    fontStyle: props.fontStyle ?? inherited.fontStyle,
    color: props.color ?? inherited.color ?? '#ffffff',
    lineHeight: props.lineHeight ?? inherited.lineHeight ?? 'normal',
    letterSpacing: props.letterSpacing ?? inherited.letterSpacing,
    textTransform: props.textCase ?? inherited.textCase ?? 'none',
    fontVariationSettings: cssFontSettings(props.fontAxes ?? (inherited.fontAxes && JSON.stringify(inherited.fontAxes)), 'axis'),
    fontFeatureSettings: cssFontSettings(props.openType ?? (inherited.openType && JSON.stringify(inherited.openType)), 'feature'),
    textAlign: props.align as any,
    whiteSpace: props.resize === 'auto-width' && props.maxWidth == null ? 'pre' as const : 'pre-wrap' as const,
  }
})
</script>

<template>
  <div class="studio-text-v1" :data-studio-text-id="id" :data-studio-text-version="version" :data-studio-text-pos="pos" :data-resize="resize" :style="style"><div class="studio-text-content"><DecoratedContent :decoration="decoration ?? shared?.character.decoration ?? 'none'"><slot /></DecoratedContent></div></div>
</template>

<style>
.studio-text-content { counter-reset: studio-text-list-0 studio-text-list-1 studio-text-list-2 studio-text-list-3 studio-text-list-4 studio-text-list-5 studio-text-list-6 studio-text-list-7 studio-text-list-8 studio-text-list-9 studio-text-list-10 studio-text-list-11 studio-text-list-12; }
</style>
