import { describe, expect, it } from 'vitest'
import type { EditableCharacterProperty, StudioSelection } from '../shared/studiotext'
import { parseStudioText, serializeStudioText } from '../shared/studiotext'
import { applyTypography, resolveCharacterProperty, resolveParagraphAlignment, resolveToggle, resolveVerticalAlignment } from '../shared/typography'

const source = (body: string, attrs = '') =>
  `<StudioText version="1" id="alpha" pos="1,2,300,auto" resize="auto-height" font-family="Inter" :font-size="64" font-weight="400" color="#ffffff" ${attrs}>${body}</StudioText>`
const doc = (value: string) => {
  const parsed = parseStudioText(value)
  if (!parsed.ok) throw Error(parsed.reason)
  return parsed.document
}
const object: StudioSelection = { mode: 'objects', ids: ['alpha'] }
const range: StudioSelection = { mode: 'textRange', textId: 'alpha',
  anchor: { paragraph: 0, grapheme: 6 }, focus: { paragraph: 0, grapheme: 11 } }
const caret: StudioSelection = { mode: 'textCaret', textId: 'alpha', at: { paragraph: 0, grapheme: 6 } }
const properties: [EditableCharacterProperty, string | number][] = [
  ['fontFamily', 'IBM Plex Sans'], ['fontWeight', 650], ['fontStyle', 'oblique'], ['fontSize', 72.5],
  ['color', '#112233aa'], ['lineHeight', '120%'], ['letterSpacing', '-1.5px'],
  ['decoration', 'underline line-through'], ['textCase', 'uppercase'],
]

describe('M2 property resolution and mutation', () => {
  it.each(properties)('%s uses object, range, and caret scopes with a stable round trip', (property, value) => {
    const before = doc(source('Hello world'))
    const changedObject = applyTypography(before, object, { domain: 'character', property, value })
    expect(changedObject.document.defaults[property]).toBe(value)
    expect(changedObject.document.paragraphs[0].runs[0].text).toBe('Hello world')
    expect(resolveCharacterProperty(changedObject.document, object, property)).toEqual({ state: 'value', value })
    expect(doc(serializeStudioText(changedObject.document))).toEqual(changedObject.document)

    const changedRange = applyTypography(before, range, { domain: 'character', property, value })
    expect(changedRange.document.paragraphs[0].runs.map(run => run.text)).toEqual(['Hello ', 'world'])
    expect(changedRange.document.paragraphs[0].runs[0].overrides).toEqual({})
    expect(changedRange.document.paragraphs[0].runs[1].overrides[property]).toBe(value)
    expect(resolveCharacterProperty(changedRange.document, range, property)).toEqual({ state: 'value', value })
    expect(resolveCharacterProperty(changedRange.document,
      { ...range, anchor: { paragraph: 0, grapheme: 0 } }, property)).toEqual({ state: 'mixed' })
    expect(doc(serializeStudioText(changedRange.document))).toEqual(changedRange.document)

    const changedCaret = applyTypography(before, caret, { domain: 'character', property, value })
    expect(changedCaret.document).toBe(before)
    expect((changedCaret.selection as Extract<StudioSelection, { mode: 'textCaret' }>).typingStyle?.[property]).toBe(value)
    expect(resolveCharacterProperty(before, changedCaret.selection, property)).toEqual({ state: 'value', value })
    expect(serializeStudioText(changedCaret.document)).toBe(serializeStudioText(before))
  })

  it('resolves mixed effective values and inherited equality', () => {
    const mixed = doc(source('<StudioRun font-size="48">Hello </StudioRun><StudioRun font-size="72">world</StudioRun>'))
    expect(resolveCharacterProperty(mixed, { ...range, anchor: { paragraph: 0, grapheme: 0 } }, 'fontSize')).toEqual({ state: 'mixed' })
    const unified = applyTypography(mixed, { ...range, anchor: { paragraph: 0, grapheme: 0 } },
      { domain: 'character', property: 'fontSize', value: 72 }).document
    expect(unified.paragraphs[0].runs).toEqual([{ text: 'Hello world', overrides: { fontSize: 72 } }])
    const equal = doc(source('Hello <StudioRun font-size="64">world</StudioRun>'))
    expect(resolveCharacterProperty(equal, { ...range, anchor: { paragraph: 0, grapheme: 0 } }, 'fontSize'))
      .toEqual({ state: 'value', value: 64 })
    const noOp = applyTypography(equal, { ...range, anchor: { paragraph: 0, grapheme: 0 } },
      { domain: 'character', property: 'fontSize', value: 64 })
    expect(noOp.noOp).toBe(true)
    expect(noOp.document).toBe(equal)
  })

  it('preserves an explicitly quoted multiword font family', () => {
    const before = doc(source('Hello world'))
    const value = '"IBM Plex Sans"'
    const changed = applyTypography(before, object, { domain: 'character', property: 'fontFamily', value }).document
    const serialized = serializeStudioText(changed)
    expect(serialized).toContain('font-family="&quot;IBM Plex Sans&quot;"')
    expect(doc(serialized).defaults.fontFamily).toBe(value)
  })

  it('keeps source text unchanged for visual case', () => {
    const before = doc(source('Hello World'))
    const changed = applyTypography(before, object, { domain: 'character', property: 'textCase', value: 'uppercase' })
    expect(serializeStudioText(changed.document)).toContain('>Hello World</StudioText>')
    expect(changed.document.defaults.textCase).toBe('uppercase')
  })

  it.each(['none', 'uppercase', 'lowercase', 'capitalize'] as const)('round trips %s case without replacing characters', (value) => {
    const before = doc(source('Hello World'))
    const changed = applyTypography(before, object, { domain: 'character', property: 'textCase', value }).document
    expect(changed.paragraphs[0].runs[0].text).toBe('Hello World')
    expect(doc(serializeStudioText(changed))).toEqual(changed)
  })

  it.each(['normal', '1.2', '48px', '120%'])('accepts canonical line height %s', (value) => {
    const changed = applyTypography(doc(source('Hello world')), object,
      { domain: 'character', property: 'lineHeight', value }).document
    expect(doc(serializeStudioText(changed))).toEqual(changed)
  })

  it.each(['0', '-1px', '0.02em'])('accepts canonical letter spacing %s', (value) => {
    const changed = applyTypography(doc(source('Hello world')), object,
      { domain: 'character', property: 'letterSpacing', value }).document
    expect(doc(serializeStudioText(changed))).toEqual(changed)
  })

  it('handles paragraph and object domains without run attributes', () => {
    const before = doc(source('<StudioParagraph>One</StudioParagraph><StudioParagraph align="right">Two</StudioParagraph><StudioParagraph>Three</StudioParagraph>'))
    const atSecond: StudioSelection = { mode: 'textCaret', textId: 'alpha', at: { paragraph: 1, grapheme: 1 } }
    const centered = applyTypography(before, atSecond, { domain: 'paragraph', property: 'align', value: 'center' }).document
    expect(centered.paragraphs.map(p => p.properties.align)).toEqual([undefined, 'center', undefined])
    const spanning: StudioSelection = { mode: 'textRange', textId: 'alpha',
      anchor: { paragraph: 0, grapheme: 1 }, focus: { paragraph: 2, grapheme: 3 } }
    const right = applyTypography(before, spanning, { domain: 'paragraph', property: 'align', value: 'right' }).document
    expect(right.paragraphs.map(p => p.properties.align)).toEqual(['right', 'right', 'right'])
    const all = applyTypography(before, object, { domain: 'paragraph', property: 'align', value: 'justify' }).document
    expect(all.align).toBe('justify')
    expect(all.paragraphs.every(p => p.properties.align === undefined)).toBe(true)
    expect(resolveParagraphAlignment(before, object)).toEqual({ state: 'mixed' })
    expect(resolveParagraphAlignment(all, object)).toEqual({ state: 'value', value: 'justify' })
    const vertical = applyTypography(before, spanning, { domain: 'object', property: 'verticalAlign', value: 'bottom' }).document
    expect(vertical.verticalAlign).toBe('bottom')
    expect(resolveVerticalAlignment(vertical, spanning)).toEqual({ state: 'value', value: 'bottom' })
    expect(vertical.paragraphs).toEqual(before.paragraphs)
    expect(doc(serializeStudioText(all))).toEqual(all)
  })

  it('toggles independent decorations and preserves nonstandard weights', () => {
    const before = doc(source('Hello world'))
    const underlined = applyTypography(before, range, { domain: 'toggle', property: 'underline' }).document
    const both = applyTypography(underlined, range, { domain: 'toggle', property: 'strikethrough' }).document
    expect(both.paragraphs[0].runs[1].overrides.decoration).toBe('underline line-through')
    const strike = applyTypography(both, range, { domain: 'toggle', property: 'underline' }).document
    expect(strike.paragraphs[0].runs[1].overrides.decoration).toBe('line-through')
    expect(resolveToggle(strike, range, 'strikethrough')).toEqual({ state: 'value', value: true })
    const regularBold = applyTypography(before, range, { domain: 'toggle', property: 'bold' }).document
    expect(regularBold.paragraphs[0].runs[1].overrides.fontWeight).toBe(700)
    expect(applyTypography(regularBold, range, { domain: 'toggle', property: 'bold' }).document.paragraphs[0].runs)
      .toEqual([{ text: 'Hello world', overrides: {} }])
    const unusual = doc(source('Hello world').replace('font-weight="400"', 'font-weight="600"'))
    expect(resolveToggle(unusual, object, 'bold').state).toBe('unavailable')
    expect(() => applyTypography(unusual, object, { domain: 'toggle', property: 'bold' })).toThrow('nonstandard')
    const mixedUnusual = doc(source('<StudioRun font-weight="400">Hello </StudioRun><StudioRun font-weight="600">world</StudioRun>'))
    expect(resolveToggle(mixedUnusual, { ...range, anchor: { paragraph: 0, grapheme: 0 } }, 'bold').state).toBe('unavailable')
    const italic = applyTypography(before, range, { domain: 'toggle', property: 'italic' }).document
    expect(italic.paragraphs[0].runs[1].overrides.fontStyle).toBe('italic')
    expect(applyTypography(italic, range, { domain: 'toggle', property: 'italic' }).document.paragraphs[0].runs)
      .toEqual([{ text: 'Hello world', overrides: {} }])
    const untouched = applyTypography(before, range, { domain: 'character', property: 'decoration', value: 'none' })
    expect(untouched.noOp).toBe(true)
    expect(untouched.document).toBe(before)
  })

  it('drops inherited overrides and merges runs after range unification', () => {
    const before = doc(source('<StudioRun font-size="72">Hello </StudioRun><StudioRun font-size="80">world</StudioRun>'))
    const whole: StudioSelection = { ...range, anchor: { paragraph: 0, grapheme: 0 } }
    const inherited = applyTypography(before, whole, { domain: 'character', property: 'fontSize', value: 64 }).document
    expect(inherited.paragraphs[0].runs).toEqual([{ text: 'Hello world', overrides: {} }])
    const weights = doc(source('<StudioRun font-weight="400">Hello </StudioRun><StudioRun font-weight="700">world</StudioRun>'))
    const unified = applyTypography(weights, whole, { domain: 'character', property: 'fontWeight', value: 700 }).document
    expect(unified.paragraphs[0].runs).toEqual([{ text: 'Hello world', overrides: { fontWeight: 700 } }])
  })

  it.each(['top', 'center', 'bottom'] as const)('keeps %s vertical alignment at object scope', (value) => {
    const before = doc(source('Hello world'))
    const changed = applyTypography(before, range, { domain: 'object', property: 'verticalAlign', value }).document
    expect(changed.verticalAlign).toBe(value)
    expect(changed.paragraphs).toEqual(before.paragraphs)
    expect(doc(serializeStudioText(changed))).toEqual(changed)
  })

  it('returns unavailable reasons and rejects unsafe grammar values', () => {
    expect(resolveCharacterProperty(null, object, 'fontSize', 'Unsupported dynamic expression'))
      .toEqual({ state: 'unavailable', reason: 'Unsupported dynamic expression' })
    expect(resolveCharacterProperty(doc(source('Hello world')), { mode: 'objects', ids: ['other'] }, 'fontSize').state)
      .toBe('unavailable')
    for (const invalid of ['calc(1em + 2px)', '1.2rem', 'javascript:x']) {
      expect(parseStudioText(source('Hello world', `line-height="${invalid}"`))).toMatchObject({ ok: false })
    }
    expect(parseStudioText(source('Hello world', 'text-case="small-caps"')).ok).toBe(false)
    expect(parseStudioText(source('Hello world', ':text-case="expr"')).ok).toBe(false)
    expect(() => applyTypography(doc(source('Hello world')), object,
      { domain: 'character', property: 'letterSpacing', value: 'calc(1px + 2px)' })).toThrow('Invalid letter spacing')
  })
})
