import type { ResolvedSlidevOptions } from '@slidev/types'
import type { FontAxis, FontCatalog, FontResource } from '../shared/font-catalog'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import * as fontkit from 'fontkit'

interface ConfigFont extends Partial<FontResource> { family: string, source: 'project' | 'web' | 'system' }
interface FontConfig { version: 1, fonts: ConfigFont[] }
const axisNames: Record<string, string> = { wght: 'Weight', wdth: 'Width', opsz: 'Optical size', slnt: 'Slant', ital: 'Italic' }
const featureNames: Record<string, string> = { liga: 'Standard ligatures', dlig: 'Discretionary ligatures',
  kern: 'Kerning', tnum: 'Tabular figures', pnum: 'Proportional figures', frac: 'Fractions', zero: 'Slashed zero' }
const cache = new Map<string, { signature: string, catalog: FontCatalog }>()

async function readJson(path: string): Promise<any | null> {
  try { return JSON.parse(await readFile(path, 'utf8')) }
  catch { return null }
}
async function signature(root: string): Promise<string> {
  const parts: string[] = []
  for (const file of [join(root, 'package.json'), join(root, 'pnpm-lock.yaml'), join(root, 'package-lock.json'), join(root, 'public', 'studio-fonts.json')]) {
    try { const s = await stat(file); parts.push(`${file}:${s.size}:${s.mtimeMs}`) }
    catch { parts.push(`${file}:absent`) }
  }
  const fonts = join(root, 'public', 'fonts')
  try {
    for (const entry of await readdir(fonts, { withFileTypes: true, recursive: true }) as any[]) {
      if (!entry.isFile() || !/\.(?:woff2?|ttf|otf)$/i.test(entry.name)) continue
      const path = join(entry.parentPath ?? fonts, entry.name)
      const s = await stat(path)
      parts.push(`${path}:${s.size}:${s.mtimeMs}`)
    }
  }
  catch { /* No local font directory. */ }
  return parts.join('|')
}
function fontTables(path: string): Pick<FontResource, 'variableAxes' | 'openTypeFeatures'> & { family: string, weight: number, style: string } | null {
  try {
    const font = fontkit.openSync(path)
    const axes = Object.entries((font as unknown as { variationAxes?: Record<string, unknown> }).variationAxes ?? {}).flatMap(([tag, raw]) => {
      const value = raw as { name: string, min: number, max: number, default: number }
      return /^[A-Za-z0-9]{4}$/.test(tag) && [value.min, value.max, value.default].every(Number.isFinite)
        ? [{ tag, name: value.name || axisNames[tag] || tag, min: value.min, max: value.max, default: value.default }] : []
    }).sort((a, b) => a.tag.localeCompare(b.tag))
    const features = [...new Set(font.availableFeatures ?? [])]
      .filter(tag => /^[A-Za-z0-9]{4}$/.test(tag)).sort()
      .map(tag => ({ tag, name: featureNames[tag] ?? tag }))
    return { family: font.familyName, weight: Number(font['OS/2']?.usWeightClass ?? 400),
      style: font.subfamilyName.toLowerCase().includes('italic') ? 'italic' : 'normal',
      variableAxes: axes, openTypeFeatures: features }
  }
  catch { return null }
}
async function sampleFont(dir: string): Promise<ReturnType<typeof fontTables>> {
  try {
    const files = (await readdir(join(dir, 'files'))).filter(name => name.endsWith('.woff2'))
    const name = files.find(name => /latin-standard-normal\.woff2$/.test(name))
      ?? files.find(name => /latin-400-normal\.woff2$/.test(name))
      ?? files.find(name => /latin.*normal\.woff2$/.test(name)) ?? files[0]
    return name ? fontTables(join(dir, 'files', name)) : null
  }
  catch { return null }
}
function axes(raw: unknown): FontAxis[] {
  if (!raw || typeof raw !== 'object') return []
  return Object.entries(raw).flatMap(([tag, data]) => {
    if (!/^[A-Za-z0-9]{4}$/.test(tag) || !data || typeof data !== 'object') return []
    const values = data as Record<string, unknown>
    const min = Number(values.min), max = Number(values.max), base = Number(values.default), step = Number(values.step)
    if (![min, max, base].every(Number.isFinite) || min > base || base > max) return []
    return [{ tag, name: axisNames[tag] ?? tag, min, max, default: base,
      ...(Number.isFinite(step) && step > 0 ? { step } : {}) }]
  }).sort((a, b) => a.tag.localeCompare(b.tag))
}
function fromFontsource(metadata: any, name: string, variable: boolean): FontResource | null {
  if (!metadata || typeof metadata.family !== 'string' || !metadata.family) return null
  const weights = Array.isArray(metadata.weights) ? metadata.weights.filter((n: unknown) => typeof n === 'number' && n > 0 && n <= 1000) : []
  const styles = Array.isArray(metadata.styles) ? metadata.styles.filter((s: unknown) => s === 'normal' || s === 'italic' || s === 'oblique') : []
  return {
    family: variable ? `${metadata.family} Variable` : metadata.family, source: 'project',
    styles: weights.flatMap((weight: number) => styles.map((style: string) => ({ weight, style }))),
    variableAxes: variable ? axes(metadata.variable) : [], openTypeFeatures: [],
    metadataSource: `@fontsource${variable ? '-variable' : ''}/${name}/metadata.json`,
  }
}
function configured(raw: unknown): ConfigFont[] {
  if (!raw || typeof raw !== 'object' || (raw as FontConfig).version !== 1 || !Array.isArray((raw as FontConfig).fonts)) return []
  return (raw as FontConfig).fonts.filter(font => font && typeof font.family === 'string' && font.family.trim()
    && ['project', 'web', 'system'].includes(font.source))
}
export async function buildFontCatalog(options: Pick<ResolvedSlidevOptions, 'userRoot'>): Promise<FontCatalog> {
  const root = options.userRoot
  const token = await signature(root)
  const prior = cache.get(root)
  if (prior?.signature === token) return prior.catalog
  const byFamily = new Map<string, FontResource>()
  for (const [scope, variable] of [['@fontsource', false], ['@fontsource-variable', true]] as const) {
    const dir = join(root, 'node_modules', scope)
    let names: string[] = []
    try { names = (await readdir(dir, { withFileTypes: true })).filter(item => item.isDirectory() || item.isSymbolicLink()).map(item => item.name) }
    catch { /* Project has no packages in this scope. */ }
    for (const name of names.sort()) {
      const resource = fromFontsource(await readJson(join(dir, name, 'metadata.json')), name, variable)
      if (resource) {
        const actual = await sampleFont(join(dir, name))
        if (actual) { resource.variableAxes = actual.variableAxes; resource.openTypeFeatures = actual.openTypeFeatures;
          resource.metadataSource += ' + WOFF2 tables' }
        else resource.variableAxes = []
        byFamily.set(resource.family.toLocaleLowerCase(), resource)
      }
    }
  }
  const fontDir = join(root, 'public', 'fonts')
  try {
    for (const entry of await readdir(fontDir, { withFileTypes: true, recursive: true }) as any[]) {
      if (!entry.isFile() || !/\.(?:woff2?|ttf|otf)$/i.test(entry.name)) continue
      const path = join(entry.parentPath ?? fontDir, entry.name)
      const actual = fontTables(path)
      if (!actual?.family) continue
      const key = actual.family.toLocaleLowerCase()
      const old = byFamily.get(key)
      byFamily.set(key, { family: actual.family, source: 'project',
        styles: [...(old?.styles ?? []), { weight: actual.weight, style: actual.style }],
        variableAxes: actual.variableAxes.length ? actual.variableAxes : old?.variableAxes ?? [],
        openTypeFeatures: [...new Map([...(old?.openTypeFeatures ?? []), ...actual.openTypeFeatures]
          .map(feature => [feature.tag, feature])).values()].sort((a, b) => a.tag.localeCompare(b.tag)),
        metadataSource: `font tables: ${path.slice(root.length + 1).replaceAll('\\', '/')}` })
    }
  }
  catch { /* No local fonts. */ }
  const config = configured(await readJson(join(root, 'public', 'studio-fonts.json')))
  for (const item of config) {
    const key = item.family.toLocaleLowerCase()
    // Configured metadata augments a bundled package. A web/system declaration
    // cannot override a project-owned family with lower source priority.
    const previous = byFamily.get(key)
    const priority = { project: 0, web: 1, system: 2 }
    if (previous && priority[previous.source] < priority[item.source]) continue
    const features = Array.isArray(item.openTypeFeatures) ? item.openTypeFeatures.filter(feature =>
      feature && /^[A-Za-z0-9]{4}$/.test(feature.tag) && typeof feature.name === 'string') : []
    byFamily.set(key, { family: item.family, source: item.source,
      styles: Array.isArray(item.styles) ? item.styles.filter(face => face && Number.isFinite(face.weight) && face.weight >= 1 && face.weight <= 1000 && ['normal', 'italic', 'oblique'].includes(face.style)) : previous?.styles ?? [],
      variableAxes: Array.isArray(item.variableAxes) ? item.variableAxes.filter(axis => axis && /^[A-Za-z0-9]{4}$/.test(axis.tag) && [axis.min, axis.max, axis.default].every(Number.isFinite) && axis.min <= axis.default && axis.default <= axis.max) : previous?.variableAxes ?? [],
      openTypeFeatures: features.length ? features : previous?.openTypeFeatures ?? [], metadataSource: 'public/studio-fonts.json' })
  }
  const order = { project: 0, web: 1, system: 2 }
  const catalog: FontCatalog = { version: 1, fonts: [...byFamily.values()].sort((a, b) =>
    order[a.source] - order[b.source] || a.family.localeCompare(b.family)) }
  cache.set(root, { signature: token, catalog })
  return catalog
}
