<script setup lang="ts">
defineProps<{ align?: string }>()
</script>

<template>
  <p class="studio-text-paragraph" :style="{ textAlign: align as any, margin: 0 }"><slot /></p>
</template>
