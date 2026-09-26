import type { StudioTextStyleFile } from '../shared/text-styles'
import type { ParagraphStyle } from '../shared/studiotext'
import type { ComputedRef, InjectionKey } from 'vue'
import { shallowRef } from 'vue'

export const runtimeTextStyles = shallowRef<StudioTextStyleFile>({ version: 1, styles: [] })
export const studioParagraphStyleKey: InjectionKey<ComputedRef<ParagraphStyle>> = Symbol('StudioText shared paragraph')
let pending: Promise<void> | undefined
export async function loadRuntimeTextStyles(force = false) {
  if (pending && !force) return pending
  pending = (async () => {
    try {
      const url = `${import.meta.env.BASE_URL}studio-text-styles.json`
      const response = await fetch(url)
      if (response.status === 404) { runtimeTextStyles.value = { version: 1, styles: [] }; return }
      if (!response.ok) return
      const value = await response.json() as StudioTextStyleFile
      if (value.version === 1 && Array.isArray(value.styles)) runtimeTextStyles.value = value
    }
    catch { /* Keep the last usable catalog during a transient reload. */ }
  })()
  return pending
}
if (import.meta.hot) import.meta.hot.on('studio-text-styles-updated', () => { void loadRuntimeTextStyles(true) })
