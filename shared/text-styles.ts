import type { CharacterStyle, ParagraphStyle, TextDocument } from './studiotext'
import { defaultStyle, validateCharacterValue, validateTagMap } from './studiotext'

export interface StudioTextStyle {
  id: string
  name: string
  character: Partial<CharacterStyle>
  paragraph: ParagraphStyle
}
export interface StudioTextStyleFile { version: 1, styles: StudioTextStyle[] }
export const EMPTY_TEXT_STYLES: StudioTextStyleFile = { version: 1, styles: [] }
const characterKeys = new Set(['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'lineHeight', 'letterSpacing', 'decoration', 'textCase', 'fontAxes', 'openType'])
const paragraphKeys = new Set(['align', 'spacingBefore', 'spacingAfter', 'indent', 'firstLineIndent', 'direction', 'list'])
function validateCharacter(input: unknown): Partial<CharacterStyle> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid style character')
  const result: Partial<CharacterStyle> = {}
  for (const [key, value] of Object.entries(input).sort(([a], [b]) => a.localeCompare(b))) {
    if (!characterKeys.has(key)) throw Error(`Unsupported character style: ${key}`)
    if (key === 'fontAxes' || key === 'openType') (result as any)[key] = validateTagMap(key, value)
    else (result as any)[key] = validateCharacterValue(key as any, value)
  }
  return result
}
function validateParagraph(input: unknown): ParagraphStyle {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid style paragraph')
  const result: ParagraphStyle = {}
  for (const [key, value] of Object.entries(input).sort(([a], [b]) => a.localeCompare(b))) {
    if (!paragraphKeys.has(key)) throw Error(`Unsupported paragraph style: ${key}`)
    if (key === 'align') {
      if (!['left', 'center', 'right', 'justify'].includes(String(value))) throw Error('Invalid style align')
      result.align = value as ParagraphStyle['align']
    }
    else if (key === 'direction') {
      if (!['auto', 'ltr', 'rtl'].includes(String(value))) throw Error('Invalid style direction')
      result.direction = value as ParagraphStyle['direction']
    }
    else if (key === 'list') {
      const list = value as ParagraphStyle['list']
      if (list === null) { result.list = null; continue }
      if (!list || !['bullet', 'ordered'].includes(list.kind) || !Number.isSafeInteger(list.level) || list.level < 0 || list.level > 12) throw Error('Invalid style list')
      result.list = { kind: list.kind, level: list.level }
    }
    else {
      if (typeof value !== 'number' || !Number.isFinite(value) || key.startsWith('spacing') && value < 0) throw Error('Invalid style measurement')
      ;(result as any)[key] = value
    }
  }
  return result
}
export function parseTextStyles(raw: unknown): StudioTextStyleFile {
  if (!raw || typeof raw !== 'object' || (raw as StudioTextStyleFile).version !== 1
    || !Array.isArray((raw as StudioTextStyleFile).styles)) throw Error('Unsupported text style file')
  const ids = new Set<string>()
  const styles = (raw as StudioTextStyleFile).styles.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9][\w./ -]{0,127}$/.test(item.id)
      || typeof item.name !== 'string' || !item.name.trim() || ids.has(item.id)) throw Error('Invalid or duplicate text style')
    ids.add(item.id)
    return { id: item.id, name: item.name, character: validateCharacter(item.character ?? {}),
      paragraph: validateParagraph(item.paragraph ?? {}) }
  }).sort((a, b) => a.id.localeCompare(b.id))
  return { version: 1, styles }
}
export function serializeTextStyles(input: StudioTextStyleFile): string {
  return `${JSON.stringify(parseTextStyles(input), null, 2)}\n`
}
export function resolveTextStyle(document: TextDocument, file: StudioTextStyleFile): TextDocument {
  if (!document.styleRef) return document
  const style = file.styles.find(item => item.id === document.styleRef)
  if (!style) throw Error(`Missing shared text style: ${document.styleRef}`)
  const copy = structuredClone(document)
  copy.localDefaults ??= {}
  copy.localParagraphs ??= copy.paragraphs.map(p => ({ ...p.properties }))
  copy.defaults = { ...defaultStyle, ...style.character, ...copy.localDefaults,
    fontAxes: style.character.fontAxes || copy.localDefaults.fontAxes
      ? { ...style.character.fontAxes, ...copy.localDefaults.fontAxes } : undefined,
    openType: style.character.openType || copy.localDefaults.openType
      ? { ...style.character.openType, ...copy.localDefaults.openType } : undefined }
  copy.paragraphs.forEach((paragraph, index) => {
    paragraph.properties = { ...style.paragraph, ...copy.localParagraphs![index] }
  })
  return copy
}
export function applyTextStyle(document: TextDocument, id: string, file: StudioTextStyleFile): TextDocument {
  if (!file.styles.some(item => item.id === id)) throw Error(`Unknown shared text style: ${id}`)
  const next = structuredClone(document)
  next.styleRef = id
  next.defaults = { ...defaultStyle }
  next.localDefaults = {}
  next.localParagraphs = next.paragraphs.map(() => ({}))
  return resolveTextStyle(next, file)
}
export function detachTextStyle(document: TextDocument, file: StudioTextStyleFile): TextDocument {
  if (!document.styleRef) return document
  const resolved = resolveTextStyle(document, file)
  delete resolved.styleRef
  delete resolved.localDefaults
  delete resolved.localParagraphs
  return resolved
}
