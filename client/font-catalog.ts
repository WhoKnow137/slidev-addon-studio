import type { FontCatalog, FontResource } from '../shared/font-catalog'
import { EMPTY_FONT_CATALOG, findFont } from '../shared/font-catalog'
import { shallowRef } from 'vue'

export const fontCatalog = shallowRef<FontCatalog>(EMPTY_FONT_CATALOG)
export const fontCatalogError = shallowRef<string | null>(null)
let pending: Promise<void> | undefined
const system = new Map<string, FontResource>()
const generic = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'])
export const fontLoadState = shallowRef<Record<string, 'loading' | 'loaded' | 'failed' | 'unavailable'>>({})
const fontLoads = new Map<string, Promise<void>>()

export async function loadFontCatalog(force = false): Promise<void> {
  if (force) { fontLoads.clear(); fontLoadState.value = {} }
  if (pending && !force) return pending
  pending = (async () => {
    try {
      const response = await fetch('/@studio/fonts')
      if (!response.ok) throw Error(`Font catalog failed (${response.status})`)
      const value = await response.json() as FontCatalog
      if (value.version !== 1 || !Array.isArray(value.fonts)) throw Error('Unsupported font catalog')
      fontCatalog.value = { version: 1, fonts: [...value.fonts, ...system.values()] }
      fontCatalogError.value = null
    }
    catch (error) { fontCatalogError.value = error instanceof Error ? error.message : String(error) }
  })()
  await pending
}
export function fontStatus(family: string): 'project' | 'web' | 'system' | 'generic' | 'missing' {
  if (generic.has(family.toLocaleLowerCase())) return 'generic'
  return findFont(fontCatalog.value, family)?.source ?? 'missing'
}
export async function discoverSystemFonts(): Promise<number> {
  const query = (window as any).queryLocalFonts as undefined | (() => Promise<{ family: string, style: string }[]>)
  if (!query) throw Error('System font enumeration is unavailable in this browser.')
  const faces = await query()
  for (const face of faces) {
    if (typeof face.family !== 'string' || !face.family.trim()) continue
    const key = face.family.toLocaleLowerCase()
    if (!system.has(key)) system.set(key, { family: face.family, source: 'system', styles: [],
      variableAxes: [], openTypeFeatures: [], metadataSource: 'browser Local Font Access' })
  }
  fontCatalog.value = { ...fontCatalog.value, fonts: [...fontCatalog.value.fonts.filter(item => item.source !== 'system'), ...system.values()] }
  return system.size
}

export async function waitForFont(family: string): Promise<void> {
  if (!family.trim() || !document.fonts?.load) return
  const key = family.toLocaleLowerCase()
  if (fontLoads.has(key)) return fontLoads.get(key)
  const loading = (async () => {
    fontLoadState.value = { ...fontLoadState.value, [key]: 'loading' }
    try {
      const faces = await Promise.race([document.fonts.load(`16px "${family.replaceAll('"', '\\"')}"`),
        new Promise<FontFace[]>(resolve => setTimeout(() => resolve([]), 2500))])
      fontLoadState.value = { ...fontLoadState.value, [key]: faces.length || fontStatus(family) === 'system' || fontStatus(family) === 'generic' ? 'loaded' : 'unavailable' }
    }
    catch { fontLoadState.value = { ...fontLoadState.value, [key]: 'failed' } }
    // Failure never substitutes or changes the requested source family.
  })()
  fontLoads.set(key, loading)
  return loading
}
