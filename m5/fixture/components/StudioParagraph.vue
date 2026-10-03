<script setup lang="ts">
import { computed, inject } from 'vue'
import { DecoratedContent, studioDecorationKey } from './studio-decoration'
import { studioParagraphStyleKey } from './shared-text-styles'
const props = defineProps<{
  align?: string
  spacingBefore?: number | string
  spacingAfter?: number | string
  indent?: number | string
  firstLineIndent?: number | string
  listKind?: 'bullet' | 'ordered' | 'none'
  listLevel?: number | string
  direction?: 'auto' | 'ltr' | 'rtl'
}>()
const decoration = inject(studioDecorationKey, computed(() => 'none'))
const inherited = inject(studioParagraphStyleKey, computed(() => ({})))
const kind = computed(() => props.listKind ?? inherited.value.list?.kind)
const level = computed(() => Number(props.listLevel ?? inherited.value.list?.level ?? 0))
const direction = computed(() => props.direction ?? inherited.value.direction ?? 'auto')
const listIndent = computed(() => Number(props.indent ?? inherited.value.indent ?? 0) + (kind.value === 'bullet' || kind.value === 'ordered' ? (level.value + 1) * 24 : 0))
const style = computed(() => ({
  textAlign: (props.align ?? inherited.value.align) as any,
  marginTop: `${Number(props.spacingBefore ?? inherited.value.spacingBefore ?? 0)}px`,
  marginBottom: `${Number(props.spacingAfter ?? inherited.value.spacingAfter ?? 0)}px`,
  paddingInlineStart: `${listIndent.value}px`,
  '--studio-list-indent': `${listIndent.value}px`,
  '--studio-list-marker': `counter(studio-text-list-${level.value}) "."`,
  counterIncrement: kind.value === 'ordered' ? `studio-text-list-${level.value}` : undefined,
  counterReset: Array.from({ length: 13 }, (_, i) => i).filter(i => !kind.value || kind.value === 'none' || i > level.value).map(i => `studio-text-list-${i}`).join(' ') || undefined,
  textIndent: `${Number(props.firstLineIndent ?? inherited.value.firstLineIndent ?? 0)}px`,
}))
</script>

<template>
  <p class="studio-text-paragraph" :dir="direction" :class="kind && `studio-text-list-${kind}`" :style="style"><DecoratedContent :decoration="decoration"><slot /></DecoratedContent></p>
</template>

<style>
.studio-text-paragraph.studio-text-list-bullet,
.studio-text-paragraph.studio-text-list-ordered { position: relative; }
.studio-text-paragraph.studio-text-list-bullet::before,
.studio-text-paragraph.studio-text-list-ordered::before { position: absolute; inset-inline-start: calc(var(--studio-list-indent) - 1.2em); }
.studio-text-paragraph.studio-text-list-bullet::before { content: '•'; }
.studio-text-paragraph.studio-text-list-ordered::before { content: var(--studio-list-marker); }
</style>
