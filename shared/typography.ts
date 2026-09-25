import type { CharacterStyle, EditableCharacterProperty, StudioSelection, TextDocument, TextPoint } from './studiotext'
import { graphemes, mapCharacterRange, normalizeText, orderedRange, validateCharacterValue } from './studiotext'

export type PropertyState<T> =
  | { state: 'value', value: T }
  | { state: 'mixed' }
  | { state: 'unavailable', reason: string }
export type TypographyEdit =
  | { domain: 'character', property: EditableCharacterProperty, value: string | number }
  | { domain: 'paragraph', property: 'align', value: TextDocument['align'] }
  | { domain: 'object', property: 'verticalAlign', value: TextDocument['verticalAlign'] }
  | { domain: 'toggle', property: 'bold' | 'italic' | 'underline' | 'strikethrough' }
export interface TypographyOutcome { document: TextDocument, selection: StudioSelection, noOp: boolean }

const unavailable = (reason: string): PropertyState<never> => ({ state: 'unavailable', reason })
const uniform = <T>(values: T[]): PropertyState<T> => {
  if (!values.length) return unavailable('No text is selected.')
  return values.every(value => value === values[0]) ? { state: 'value', value: values[0] } : { state: 'mixed' }
}
function belongs(document: TextDocument, selection: StudioSelection): boolean {
  return selection.mode === 'objects'
    ? selection.ids.length === 1 && selection.ids[0] === document.id
    : selection.textId === document.id
}
function paragraphLength(document: TextDocument, index: number) {
  const paragraph = document.paragraphs[index]
  if (!paragraph) throw Error('Selection outside document')
  return paragraph.runs.reduce((n, run) => n + graphemes(run.text).length, 0)
}
function paragraphsInRange(document: TextDocument, selection: Extract<StudioSelection, { mode: 'textRange' }>): number[] {
  const [start, end] = orderedRange(selection)
  if (start.paragraph < 0 || end.paragraph >= document.paragraphs.length) throw Error('Selection outside document')
  const indexes: number[] = []
  for (let p = start.paragraph; p <= end.paragraph; p++) {
    const lo = p === start.paragraph ? start.grapheme : 0
    const hi = p === end.paragraph ? end.grapheme : paragraphLength(document, p)
    if (lo < 0 || hi > paragraphLength(document, p) || hi < lo) throw Error('Selection outside paragraph')
    if (lo < hi) indexes.push(p)
  }
  return indexes
}
function rangeValues<T>(document: TextDocument, selection: Extract<StudioSelection, { mode: 'textRange' }>,
  value: (effective: CharacterStyle) => T): T[] {
  const [start, end] = orderedRange(selection)
  const result: T[] = []
  for (const p of paragraphsInRange(document, selection)) {
    const lo = p === start.paragraph ? start.grapheme : 0
    const hi = p === end.paragraph ? end.grapheme : paragraphLength(document, p)
    let offset = 0
    for (const run of document.paragraphs[p].runs) {
      const next = offset + graphemes(run.text).length
      if (Math.max(offset, lo) < Math.min(next, hi)) result.push(value({ ...document.defaults, ...run.overrides }))
      offset = next
    }
  }
  return result
}
function caretStyle(document: TextDocument, at: TextPoint): CharacterStyle {
  const paragraph = document.paragraphs[at.paragraph]
  const length = paragraphLength(document, at.paragraph)
  if (at.grapheme < 0 || at.grapheme > length) throw Error('Caret outside paragraph')
  let offset = 0
  for (const run of paragraph.runs) {
    const next = offset + graphemes(run.text).length
    if (at.grapheme <= next && (at.grapheme > offset || at.grapheme === 0))
      return { ...document.defaults, ...run.overrides }
    offset = next
  }
  return { ...document.defaults, ...(paragraph.runs.at(-1)?.overrides ?? {}) }
}
export function resolveCharacterProperty<K extends EditableCharacterProperty>(
  document: TextDocument | null, selection: StudioSelection, property: K, reason?: string | null,
): PropertyState<CharacterStyle[K]> {
  if (!document) return unavailable(reason ?? 'Select a supported StudioText object.')
  if (!belongs(document, selection)) return unavailable('Select one managed StudioText object.')
  try {
    if (selection.mode === 'objects') return { state: 'value', value: document.defaults[property] }
    if (selection.mode === 'textCaret') {
      const effective = { ...caretStyle(document, selection.at), ...selection.typingStyle }
      return { state: 'value', value: effective[property] }
    }
    return uniform(rangeValues(document, selection, effective => effective[property]))
  }
  catch (error) { return unavailable((error as Error).message) }
}
export function resolveParagraphAlignment(document: TextDocument | null, selection: StudioSelection,
  reason?: string | null): PropertyState<TextDocument['align']> {
  if (!document) return unavailable(reason ?? 'Select a supported StudioText object.')
  if (!belongs(document, selection)) return unavailable('Select one managed StudioText object.')
  try {
    const indexes = selection.mode === 'objects'
      ? document.paragraphs.map((_, index) => index)
      : selection.mode === 'textCaret' ? [selection.at.paragraph] : paragraphsInRange(document, selection)
    return uniform(indexes.map(index => document.paragraphs[index].properties.align ?? document.align))
  }
  catch (error) { return unavailable((error as Error).message) }
}
export function resolveVerticalAlignment(document: TextDocument | null, selection: StudioSelection,
  reason?: string | null): PropertyState<TextDocument['verticalAlign']> {
  if (!document) return unavailable(reason ?? 'Select a supported StudioText object.')
  return belongs(document, selection) ? { state: 'value', value: document.verticalAlign }
    : unavailable('Select one managed StudioText object.')
}
const flags = (value: CharacterStyle['decoration']) => ({
  underline: value.includes('underline'), strikethrough: value.includes('line-through'),
})
const decoration = (underline: boolean, strikethrough: boolean): CharacterStyle['decoration'] =>
  underline && strikethrough ? 'underline line-through' : underline ? 'underline' : strikethrough ? 'line-through' : 'none'
export function resolveToggle(document: TextDocument | null, selection: StudioSelection,
  property: Extract<TypographyEdit, { domain: 'toggle' }>['property'], reason?: string | null): PropertyState<boolean> {
  if (document && belongs(document, selection) && selection.mode === 'textRange') {
    try {
      if (property === 'bold' && rangeValues(document, selection, effective => effective.fontWeight)
        .some(weight => ![400, 700].includes(weight)))
        return unavailable('Use numeric Weight to preserve a nonstandard weight in this range.')
      if (property === 'italic' && rangeValues(document, selection, effective => effective.fontStyle).includes('oblique'))
        return unavailable('Use Style to preserve oblique in this range.')
    }
    catch (error) { return unavailable((error as Error).message) }
  }
  const key = property === 'bold' ? 'fontWeight' : property === 'italic' ? 'fontStyle' : 'decoration'
  const state = resolveCharacterProperty(document, selection, key, reason)
  if (state.state !== 'value') return state
  if (property === 'bold') {
    if (![400, 700].includes(state.value as number))
      return unavailable('Use numeric Weight to preserve this nonstandard weight.')
    return { state: 'value', value: state.value === 700 }
  }
  if (property === 'italic') {
    if (state.value === 'oblique') return unavailable('Use Style to preserve oblique.')
    return { state: 'value', value: state.value === 'italic' }
  }
  return { state: 'value', value: flags(state.value as CharacterStyle['decoration'])[property] }
}
function setCharacter(document: TextDocument, selection: StudioSelection, property: EditableCharacterProperty,
  value: CharacterStyle[EditableCharacterProperty]): TypographyOutcome {
  if (selection.mode === 'objects') {
    if (document.defaults[property] === value) return { document, selection, noOp: true }
    const next = structuredClone(document)
    ;(next.defaults as any)[property] = value
    return { document: normalizeText(next), selection, noOp: false }
  }
  if (selection.mode === 'textCaret') {
    const current = resolveCharacterProperty(document, selection, property)
    if (current.state === 'value' && current.value === value) return { document, selection, noOp: true }
    const typingStyle = { ...selection.typingStyle, [property]: value }
    return { document, selection: { ...selection, typingStyle }, noOp: false }
  }
  const next = mapCharacterRange(document, selection, () => ({ [property]: value }))
  return { document: next, selection, noOp: next === document }
}
export function applyTypography(document: TextDocument, selection: StudioSelection, edit: TypographyEdit): TypographyOutcome {
  if (!belongs(document, selection)) throw Error('Selection does not belong to this StudioText')
  if (edit.domain === 'character') {
    if (!['fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'color', 'lineHeight', 'letterSpacing', 'decoration', 'textCase'].includes(edit.property))
      throw Error('Unsupported character property')
    return setCharacter(document, selection, edit.property, validateCharacterValue(edit.property, edit.value))
  }
  if (edit.domain === 'paragraph') {
    if (edit.property !== 'align' || !['left', 'center', 'right', 'justify'].includes(edit.value)) throw Error('Invalid paragraph alignment')
    const next = structuredClone(document)
    if (selection.mode === 'objects') {
      next.align = edit.value
      for (const paragraph of next.paragraphs) delete paragraph.properties.align
    }
    else {
      const indexes = selection.mode === 'textCaret' ? [selection.at.paragraph] : paragraphsInRange(document, selection)
      for (const index of indexes) {
        if (!next.paragraphs[index]) throw Error('Selection outside document')
        if (edit.value === next.align) delete next.paragraphs[index].properties.align
        else next.paragraphs[index].properties.align = edit.value
      }
    }
    const noOp = JSON.stringify(next) === JSON.stringify(document)
    return { document: noOp ? document : next, selection, noOp }
  }
  if (edit.domain === 'object') {
    if (edit.property !== 'verticalAlign' || !['top', 'center', 'bottom'].includes(edit.value)) throw Error('Invalid vertical alignment')
    if (document.verticalAlign === edit.value) return { document, selection, noOp: true }
    return { document: { ...document, verticalAlign: edit.value }, selection, noOp: false }
  }
  if (edit.domain !== 'toggle' || !['bold', 'italic', 'underline', 'strikethrough'].includes(edit.property))
    throw Error('Unsupported typography action')
  const state = resolveToggle(document, selection, edit.property)
  if (state.state === 'unavailable') throw Error(state.reason)
  const turnOn = state.state === 'mixed' || !state.value
  if (edit.property === 'bold') {
    // The toggle handles standard 400/700 only. Other weights stay editable
    // through the numeric control, so no original 500/600/800 value is lost.
    const target = turnOn ? 700 : selection.mode === 'objects' ? 400
      : document.defaults.fontWeight < 600 ? document.defaults.fontWeight : 400
    return setCharacter(document, selection, 'fontWeight', target)
  }
  if (edit.property === 'italic')
    return setCharacter(document, selection, 'fontStyle', turnOn ? 'italic' : 'normal')
  const current = resolveCharacterProperty(document, selection, 'decoration')
  if (current.state === 'unavailable') throw Error(current.reason)
  const key = edit.property
  if (selection.mode === 'textRange') {
    const next = mapCharacterRange(document, selection, effective => {
      const existing = flags(effective.decoration)
      return { decoration: decoration(key === 'underline' ? turnOn : existing.underline,
        key === 'strikethrough' ? turnOn : existing.strikethrough) }
    })
    return { document: next, selection, noOp: next === document }
  }
  const effective = current.state === 'value' ? current.value : document.defaults.decoration
  const existing = flags(effective)
  return setCharacter(document, selection, 'decoration', decoration(key === 'underline' ? turnOn : existing.underline,
    key === 'strikethrough' ? turnOn : existing.strikethrough))
}
