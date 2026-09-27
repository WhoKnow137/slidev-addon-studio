<script setup lang="ts">
import type { PanelId } from '../state'
import { canRedo as genericRedo, canUndo as genericUndo, lastAction, useStudioHistory } from '../composables/useSlideSource'
import {computed} from 'vue'
import {activeLayer,sourceHistory} from '../managed-layer-editor'
import {activeText} from '../studiotext-editor'
import { activePanel, gridEnabled, outlineEnabled, snapEnabled, studioOpen } from '../state'
import StudioIcon from './parts/StudioIcon.vue'

const genericHistory = useStudioHistory()
const managed=computed(()=>!!activeLayer.value||!!activeText.value)
const canUndo=computed(()=>managed.value?sourceHistory.canUndo.value:genericUndo.value)
const canRedo=computed(()=>managed.value?sourceHistory.canRedo.value:genericRedo.value)
const history={undo:()=>managed.value?sourceHistory.undo():genericHistory.undo(),redo:()=>managed.value?sourceHistory.redo():genericHistory.redo()}

/**
 * Only shown while Studio is open. When it is closed the way in is Slidev's own
 * bottom bar, which already holds the deck's controls, so a closed editor adds
 * nothing to the slide.
 */
const tabs: { id: PanelId, icon: string, label: string }[] = [
  { id: 'inspect', icon: 'cursor', label: 'Element' },
  { id: 'components', icon: 'components', label: 'Components' },
  { id: 'animate', icon: 'animate', label: 'Animate' },
  { id: 'layout', icon: 'layout', label: 'Layout' },
  { id: 'slides', icon: 'slides', label: 'Slides' },
  { id: 'assets', icon: 'assets', label: 'Assets' },
]
</script>

<template>
  <div v-if="studioOpen" class="studio-toolbar">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="studio-tab"
      role="tab"
      :aria-selected="activePanel === tab.id"
      :title="tab.label"
      @click="activePanel = tab.id"
    >
      <StudioIcon :name="tab.icon" :size="15" />
      <span>{{ tab.label }}</span>
    </button>

    <span class="studio-toolbar__divider" />

    <button
      class="studio-icon-button"
      :disabled="!canUndo"
      :title="lastAction ? `Undo ${lastAction.toLowerCase()}` : 'Undo'"
      @click="history.undo()"
    >
      <StudioIcon name="undo" />
    </button>
    <button class="studio-icon-button" :disabled="!canRedo" title="Redo" @click="history.redo()">
      <StudioIcon name="redo" />
    </button>

    <span class="studio-toolbar__divider" />

    <button
      class="studio-icon-button"
      :aria-pressed="snapEnabled"
      title="Snap to guides. Hold Alt to bypass"
      @click="snapEnabled = !snapEnabled"
    >
      <StudioIcon name="magnet" />
    </button>
    <button class="studio-icon-button" :aria-pressed="gridEnabled" title="Snap to grid" @click="gridEnabled = !gridEnabled">
      <StudioIcon name="grid" />
    </button>
    <button
      class="studio-icon-button"
      :aria-pressed="outlineEnabled"
      title="Outline everything selectable"
      @click="outlineEnabled = !outlineEnabled"
    >
      <StudioIcon name="eye" />
    </button>

    <span class="studio-toolbar__divider" />

    <button class="studio-icon-button" title="Close Studio (E)" @click="studioOpen = false">
      <StudioIcon name="close" />
    </button>
  </div>
</template>
