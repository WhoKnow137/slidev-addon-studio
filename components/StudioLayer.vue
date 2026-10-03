<script setup lang="ts">
import {computed} from 'vue'
const props=defineProps<{version:string,id:string,slideId:string,sourceId:string,sourceType:string,instancePath?:string,parentId?:string,kind:string,pos:string,rotate:string,capability:string,reason?:string,rotation?:string,paintEvidence?:string}>()
const frame=computed(()=>{const [x,y,w,h]=props.pos.split(',').map(Number);return {position:'absolute' as const,left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`,transform:`rotate(${Number(props.rotate)}deg)`,transformOrigin:'center center'}})
</script>
<template>
  <div class="studio-managed-layer" :data-studio-object-id="id" :data-studio-layer-kind="kind" :data-studio-layer-pos="pos" :data-studio-layer-rotate="rotate" :data-studio-layer-capability="capability" :data-studio-layer-parent="parentId" :style="frame"><slot /></div>
</template>
