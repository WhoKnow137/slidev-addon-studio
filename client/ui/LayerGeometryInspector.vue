<script setup lang="ts">
import {computed} from 'vue'
import {activeLayer,selectedLayers,layerCommand,layerError,layerBusy} from '../managed-layer-editor'
import {geometryDisplay} from '../../shared/geometry'
import type {LayerGeometry} from '../../shared/managed-layer'
const fields=[['x','X'],['y','Y'],['width','W'],['height','H'],['rotationDeg','Rotation']] as const
const model=computed(()=>activeLayer.value?.document),multiple=computed(()=>selectedLayers.value.length>1)
const mixed=(k:keyof LayerGeometry)=>selectedLayers.value.some(s=>s.document.geometry[k]!==model.value?.geometry[k])
const disabled=(k:keyof LayerGeometry)=>layerBusy.value||!model.value||selectedLayers.value.some(s=>['READ_ONLY','UNAVAILABLE'].includes(s.document.capabilities.level))||(['width','height'].includes(k)&&(multiple.value||model.value.capabilities.level!=='FULL'))||(k==='rotationDeg'&&(multiple.value||!model.value.capabilities.rotation))
let focusedRevision:string|undefined
async function commit(k:keyof LayerGeometry,event:Event){
  const input=event.target as HTMLInputElement
  if(!input.value.trim()){layerError.value='Enter a finite geometry value';return}
  await layerCommand({kind:'set',property:k,value:Number(input.value)},focusedRevision)
}
</script>
<template>
  <section class="studio-section" data-testid="layer-geometry-inspector">
    <h3 class="studio-section__title">Layer transform</h3>
    <p>{{model?.kind}} · {{model?.capabilities.level}}</p>
    <p class="studio-hint">Source: {{model?.source.figmaGuid}} ({{model?.source.kiwiType}})</p>
    <p class="studio-hint" role="status">{{model?.capabilities.reason}}</p>
    <div class="studio-type-grid">
      <label v-for="[key,label] in fields" :key="key" class="studio-type-field">{{label}}
        <input :aria-label="label" type="number" step="1" :disabled="disabled(key)" :value="mixed(key)?'':model?geometryDisplay(model.geometry[key]):''" :placeholder="mixed(key)?'Mixed':''" @focus="focusedRevision=activeLayer?.revision" @change="commit(key,$event)" />
      </label>
    </div>
    <p v-if="multiple" class="studio-hint">Drag translates all selected layers. Typed X/Y sets each layer to that absolute parent-local value. Multi-resize and multi-rotate are unavailable.</p>
    <p class="studio-hint">Layer geometry only. Paint/crop, replacement, corners and structural actions are unavailable. Use Slidev’s source editor for manual source changes.</p>
    <p v-if="layerError" class="studio-error" role="alert">{{layerError}}</p>
  </section>
</template>
