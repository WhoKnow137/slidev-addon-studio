export interface FontAxis { tag: string, name: string, min: number, max: number, default: number, step?: number }
export interface FontResource {
  family: string
  source: 'project' | 'web' | 'system'
  styles: { weight: number, style: string, stretch?: string }[]
  variableAxes: FontAxis[]
  openTypeFeatures: { tag: string, name: string }[]
  metadataSource: string
}
export interface FontCatalog { version: 1, fonts: FontResource[] }
export const EMPTY_FONT_CATALOG: FontCatalog = { version: 1, fonts: [] }

export function findFont(catalog: FontCatalog, family: string): FontResource | undefined {
  return catalog.fonts.find(item => item.family.toLocaleLowerCase() === family.toLocaleLowerCase())
}
