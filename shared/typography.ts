import type { CharacterStyle, EditableCharacterProperty, ParagraphStyle, StudioSelection, TextDocument, TextPoint } from './studiotext'
import { effectiveCharacter, graphemes, mapCharacterRange, normalizeText, orderedRange, validateCharacterValue, validateLink, validateTagMap } from './studiotext'

export type PropertyState<T> =
  | { state: 'value', value: T }
  | { state: 'mixed' }
  | { state: 'unavailable', reason: string }
export type TypographyEdit =
  | { domain: 'character', property: EditableCharacterProperty, value: string | number }
  | { domain: 'paragraph', property: 'align', value: TextDocument['align'] }
  | { domain: 'paragraph', property: 'spacingBefore' | 'spacingAfter' | 'indent' | 'firstLineIndent', value: number }
  | { domain: 'paragraph', property: 'direction', value: 'auto' | 'ltr' | 'rtl' }
  | { domain: 'paragraph', property: 'list', value: ParagraphStyle['list'] | null }
  | { domain: 'list-kind', value: 'bullet' | 'ordered' | 'none' }
  | { domain: 'axis', tag: string, value: number }
  | { domain: 'feature', tag: string, value: boolean | number }
  | { domain: 'link', value: string | null }
  | { domain: 'face', weight: number, style: CharacterStyle['fontStyle'] }
  | { domain: 'object', property: 'verticalAlign', value: TextDocument['verticalAlign'] }
  | { domain: 'toggle', property: 'bold' | 'italic' | 'underline' | 'strikethrough' }
export interface TypographyOutcome { document: TextDocument, selection: StudioSelection, noOp: boolean }

const unavailable = (reason: string): PropertyState<never> => ({ state: 'unavailable', reason })
const uniform = <T>(values: T[]): PropertyState<T> => {
  if (!values.length) return unavailable('No text is selected.')
  return values.every(value => JSON.stringify(value) === JSON.stringify(values[0])) ? { state: 'value', value: values[0] } : { state: 'mixed' }
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
    if (lo < hi || p > start.paragraph && p < end.paragraph) indexes.push(p)
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
      if (Math.max(offset, lo) < Math.min(next, hi)) result.push(value(effectiveCharacter(document.defaults, run.overrides)))
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
      return effectiveCharacter(document.defaults, run.overrides)
    offset = next
  }
  return effectiveCharacter(document.defaults, paragraph.runs.at(-1)?.overrides ?? {})
}
export function resolveCharacterProperty<K extends keyof CharacterStyle>(
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
export function resolveParagraphProperty<K extends keyof ParagraphStyle>(document: TextDocument | null,
  selection: StudioSelection, property: K, reason?: string | null): PropertyState<ParagraphStyle[K]> {
  if (!document) return unavailable(reason ?? 'Select a supported StudioText object.')
  if (!belongs(document, selection)) return unavailable('Select one managed StudioText object.')
  try {
    const indexes = selection.mode === 'objects' ? document.paragraphs.map((_, index) => index)
      : selection.mode === 'textCaret' ? [selection.at.paragraph] : paragraphsInRange(document, selection)
    return uniform(indexes.map(index => document.paragraphs[index].properties[property]))
  }
  catch (error) { return unavailable((error as Error).message) }
}
export function resolveTagValue(document: TextDocument | null, selection: StudioSelection,
  property: 'fontAxes' | 'openType', tag: string, reason?: string | null): PropertyState<number | boolean | undefined> {
  if (document && belongs(document, selection) && selection.mode === 'textRange') {
    try { return uniform(rangeValues(document, selection, effective => effective[property]?.[tag])) }
    catch (error) { return unavailable((error as Error).message) }
  }
  const state = resolveCharacterProperty(document, selection, property, reason)
  if (state.state !== 'value') return state
  return { state: 'value', value: state.value?.[tag] }
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
function setCharacter(document: TextDocument, selection: StudioSelection, property: keyof CharacterStyle,
  value: CharacterStyle[keyof CharacterStyle]): TypographyOutcome {
  if (selection.mode === 'objects') {
    if (JSON.stringify(document.defaults[property]) === JSON.stringify(value)) return { document, selection, noOp: true }
    const next = structuredClone(document)
    ;(next.defaults as any)[property] = value
    ;(next.localDefaults ??= {})[property] = value as never
    return { document: normalizeText(next), selection, noOp: false }
  }
  if (selection.mode === 'textCaret') {
    const current = resolveCharacterProperty(document, selection, property, undefined)
    if (current.state === 'value' && JSON.stringify(current.value) === JSON.stringify(value)) return { document, selection, noOp: true }
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
  if (edit.domain === 'axis' || edit.domain === 'feature') {
    const property = edit.domain === 'axis' ? 'fontAxes' : 'openType'
    const entry = validateTagMap(property, { [edit.tag]: edit.value })
    const value = entry[edit.tag]
    if (selection.mode === 'objects' || selection.mode === 'textCaret') {
      const current = resolveCharacterProperty(document, selection, property)
      if (current.state !== 'value') throw Error('Cannot resolve current font setting')
      if (selection.mode === 'objects') {
        if (current.value?.[edit.tag] === value) return { document, selection, noOp: true }
        const next = structuredClone(document)
        next.defaults[property] = validateTagMap(property, { ...next.defaults[property], [edit.tag]: value }) as any
        next.localDefaults ??= {}
        ;(next.localDefaults as any)[property] = validateTagMap(property, { ...(next.localDefaults as any)[property], [edit.tag]: value })
        return { document: next, selection, noOp: false }
      }
      return setCharacter(document, selection, property, validateTagMap(property, { ...current.value, [edit.tag]: value }))
    }
    const next = mapCharacterRange(document, selection, (_effective, overrides) => ({
      [property]: validateTagMap(property, { ...overrides[property], [edit.tag]: value }),
    }))
    return { document: next, selection, noOp: next === document }
  }
  if (edit.domain === 'link') {
    if (selection.mode === 'objects') throw Error('Select a text range to edit links')
    const value = edit.value === null ? undefined : validateLink(edit.value)
    return setCharacter(document, selection, 'link', value)
  }
  if (edit.domain === 'face') {
    const weight = validateCharacterValue('fontWeight', edit.weight) as number
    const style = validateCharacterValue('fontStyle', edit.style) as CharacterStyle['fontStyle']
    if (selection.mode === 'objects') {
      const next = structuredClone(document)
      next.defaults.fontWeight = weight; next.defaults.fontStyle = style
      Object.assign(next.localDefaults ??= {}, { fontWeight: weight, fontStyle: style })
      const noOp = JSON.stringify(next) === JSON.stringify(document)
      return { document: noOp ? document : normalizeText(next), selection, noOp }
    }
    if (selection.mode === 'textCaret') {
      const typingStyle = { ...selection.typingStyle, fontWeight: weight, fontStyle: style }
      const noOp = JSON.stringify(typingStyle) === JSON.stringify(selection.typingStyle)
      return { document, selection: noOp ? selection : { ...selection, typingStyle }, noOp }
    }
    const next = mapCharacterRange(document, selection, () => ({ fontWeight: weight, fontStyle: style }))
    return { document: next, selection, noOp: next === document }
  }
  if (edit.domain === 'list-kind') {
    if (!['bullet', 'ordered', 'none'].includes(edit.value)) throw Error('Invalid list kind')
    const next = structuredClone(document)
    const indexes = selection.mode === 'objects' ? next.paragraphs.map((_, index) => index)
      : selection.mode === 'textCaret' ? [selection.at.paragraph] : paragraphsInRange(document, selection)
    for (const index of indexes) {
      const paragraph = next.paragraphs[index]
      if (!paragraph) throw Error('Selection outside document')
      if (edit.value === 'none') {
        if (next.styleRef) paragraph.properties.list = null
        else delete paragraph.properties.list
      }
      else paragraph.properties.list = { kind: edit.value, level: paragraph.properties.list?.level ?? 0 }
      if (next.styleRef) {
        next.localParagraphs ??= next.paragraphs.map(() => ({}))
        next.localParagraphs[index].list = paragraph.properties.list
      }
    }
    const noOp = JSON.stringify(next) === JSON.stringify(document)
    return { document: noOp ? document : next, selection, noOp }
  }
  if (edit.domain === 'paragraph') {
    if (!['align', 'direction', 'spacingBefore', 'spacingAfter', 'indent', 'firstLineIndent', 'list'].includes(edit.property)) throw Error('Unsupported paragraph property')
    if (edit.property === 'align' && !['left', 'center', 'right', 'justify'].includes(edit.value)) throw Error('Invalid paragraph alignment')
    if (edit.property === 'direction' && !['auto', 'ltr', 'rtl'].includes(edit.value)) throw Error('Invalid paragraph direction')
    if (['spacingBefore', 'spacingAfter', 'indent', 'firstLineIndent'].includes(edit.property)
      && (typeof edit.value !== 'number' || !Number.isFinite(edit.value)
        || (['spacingBefore', 'spacingAfter'].includes(edit.property) && edit.value < 0))) throw Error('Invalid paragraph measurement')
    if (edit.property === 'list' && edit.value !== null &&
      (!edit.value || !['bullet', 'ordered'].includes(edit.value.kind) || !Number.isSafeInteger(edit.value.level)
        || edit.value.level < 0 || edit.value.level > 12)) throw Error('Invalid list')
    const next = structuredClone(document)
    if (selection.mode === 'objects' && edit.property === 'align' && !next.styleRef) {
      next.align = edit.value
      next.explicitAttributes ??= { rotate: false, align: false, verticalAlign: false }
      next.explicitAttributes.align = true
      for (const paragraph of next.paragraphs) delete paragraph.properties.align
    }
    else {
      const indexes = selection.mode === 'objects' ? next.paragraphs.map((_, index) => index)
        : selection.mode === 'textCaret' ? [selection.at.paragraph] : paragraphsInRange(document, selection)
      for (const index of indexes) {
        if (!next.paragraphs[index]) throw Error('Selection outside document')
        if (edit.property === 'align') {
          if (!next.styleRef && edit.value === next.align) delete next.paragraphs[index].properties.align
          else next.paragraphs[index].properties.align = edit.value
        }
        else if (edit.property === 'list') {
          if (edit.value === null && !next.styleRef) delete next.paragraphs[index].properties.list
          else if (edit.value === null) next.paragraphs[index].properties.list = null
          else next.paragraphs[index].properties.list = { ...edit.value } as NonNullable<ParagraphStyle['list']>
        }
        else (next.paragraphs[index].properties as any)[edit.property] = edit.value
        if (next.styleRef) {
          next.localParagraphs ??= next.paragraphs.map(() => ({}))
          ;(next.localParagraphs[index] as any)[edit.property] = next.paragraphs[index].properties[edit.property]
        }
      }
    }
    const noOp = JSON.stringify(next) === JSON.stringify(document)
    return { document: noOp ? document : next, selection, noOp }
  }
  if (edit.domain === 'object') {
    if (edit.property !== 'verticalAlign' || !['top', 'center', 'bottom'].includes(edit.value)) throw Error('Invalid vertical alignment')
    if (document.verticalAlign === edit.value) return { document, selection, noOp: true }
    return { document: { ...document, verticalAlign: edit.value,
      explicitAttributes: { rotate: document.explicitAttributes?.rotate ?? false,
        align: document.explicitAttributes?.align ?? false, verticalAlign: true } }, selection, noOp: false }
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
