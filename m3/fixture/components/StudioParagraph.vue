<script setup lang="ts">
import { computed, inject } from 'vue'
import { DecoratedContent, studioDecorationKey } from './studio-decoration'
defineProps<{ align?: string }>()
const decoration = inject(studioDecorationKey, computed(() => 'none'))
</script>

<template>
  <p class="studio-text-paragraph" :style="{ textAlign: align as any, margin: 0 }"><DecoratedContent :decoration="decoration"><slot /></DecoratedContent></p>
</template>
