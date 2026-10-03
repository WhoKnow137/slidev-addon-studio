import { describe, expect, it } from 'vitest'
import type { StudioSelection, TextDocument } from '../shared/studiotext'
import { parseStudioText, serializeStudioText } from '../shared/studiotext'
import { applyTypography, resolveParagraphProperty, resolveTagValue } from '../shared/typography'

const markup = (body: string) => `<StudioText version="1" id="m5" pos="0,0,300,auto" resize="auto-height" font-family="Inter" :font-size="32">${body}</StudioText>`
function parse(source: string): TextDocument {
  const result = parseStudioText(source)
  if (!result.ok) throw Error(result.reason)
  return result.document
}
const object: StudioSelection = { mode: 'objects', ids: ['m5'] }
const across: StudioSelection = { mode: 'textRange', textId: 'm5',
  anchor: { paragraph: 0, grapheme: 2 }, focus: { paragraph: 2, grapheme: 2 } }

describe('M5 typed typography source', () => {
  it('changes list kind across paragraphs without losing their individual indentation levels', () => {
    const doc = parse(markup('<StudioParagraph list-kind="bullet" list-level="0">A</StudioParagraph><StudioParagraph list-kind="bullet" list-level="1">B</StudioParagraph><StudioParagraph list-kind="bullet" list-level="0">C</StudioParagraph>'))
    const changed = applyTypography(doc, object, { domain: 'list-kind', value: 'ordered' }).document
    expect(changed.paragraphs.map(p => p.properties.list)).toEqual([{ kind: 'ordered', level: 0 }, { kind: 'ordered', level: 1 }, { kind: 'ordered', level: 0 }])
    expect(parse(serializeStudioText(changed))).toEqual(changed)
    expect(applyTypography(changed, object, { domain: 'list-kind', value: 'ordered' }).noOp).toBe(true)
  })
  it('resolves each axis independently when other axes differ across runs', () => {
    const doc = parse(markup('<StudioRun font-axes="{&quot;wght&quot;:620,&quot;opsz&quot;:24}">A</StudioRun><StudioRun font-axes="{&quot;wght&quot;:620,&quot;opsz&quot;:48}">B</StudioRun>'))
    const range: StudioSelection = { mode: 'textRange', textId: 'm5', anchor: { paragraph: 0, grapheme: 0 }, focus: { paragraph: 0, grapheme: 2 } }
    expect(resolveTagValue(doc, range, 'fontAxes', 'wght')).toEqual({ state: 'value', value: 620 })
    expect(resolveTagValue(doc, range, 'fontAxes', 'opsz')).toEqual({ state: 'mixed' })
  })
  it('changes one object font without serializing unrelated default values', () => {
    const original = markup('Minimal')
    const changed = applyTypography(parse(original), object, { domain: 'character', property: 'fontFamily', value: 'NanumMyeongjo' }).document
    expect(serializeStudioText(changed)).toBe(original.replace('font-family="Inter"', 'font-family="NanumMyeongjo"'))
    expect(parse(serializeStudioText(changed))).toEqual(changed)
  })
  it('round trips ordered axes and features without CSS as source', () => {
    let document = parse(markup('Variable'))
    document = applyTypography(document, object, { domain: 'axis', tag: 'wght', value: 620 }).document
    document = applyTypography(document, object, { domain: 'axis', tag: 'wdth', value: 92 }).document
    document = applyTypography(document, object, { domain: 'feature', tag: 'tnum', value: true }).document
    const source = serializeStudioText(document)
    expect(source).toContain('font-axes="{&quot;wdth&quot;:92,&quot;wght&quot;:620}"')
    expect(source).toContain('open-type="{&quot;tnum&quot;:true}"')
    expect(parse(source)).toEqual(document)
    expect(resolveTagValue(document, object, 'fontAxes', 'wght')).toEqual({ state: 'value', value: 620 })
  })

  it('formats across three paragraphs while preserving paragraph attributes and graphemes', () => {
    const original = parse(markup('<StudioParagraph>é🇨🇦 one</StudioParagraph><StudioParagraph spacing-after="12" direction="rtl">العربية 👩‍💻</StudioParagraph><StudioParagraph>עברית two</StudioParagraph>'))
    const colored = applyTypography(original, across, { domain: 'character', property: 'color', value: '#aabbcc' }).document
    const linked = applyTypography(colored, across, { domain: 'link', value: 'https://example.com/?a=1&b=2' }).document
    expect(linked.paragraphs).toHaveLength(3)
    expect(linked.paragraphs[0].runs.map(run => run.text)).toEqual(['é🇨🇦', ' one'])
    expect(linked.paragraphs[1].properties).toEqual({ spacingAfter: 12, direction: 'rtl' })
    expect(linked.paragraphs[2].runs.map(run => run.text)).toEqual(['עב', 'רית two'])
    expect(parse(serializeStudioText(linked))).toEqual(linked)
  })

  it('applies paragraph spacing, indentation, lists and direction to intersected paragraphs', () => {
    const original = parse(markup('<StudioParagraph>First</StudioParagraph><StudioParagraph>Second</StudioParagraph><StudioParagraph>Third</StudioParagraph>'))
    let result = applyTypography(original, across, { domain: 'paragraph', property: 'spacingAfter', value: 16 }).document
    result = applyTypography(result, across, { domain: 'paragraph', property: 'indent', value: 24 }).document
    result = applyTypography(result, across, { domain: 'paragraph', property: 'firstLineIndent', value: -8 }).document
    result = applyTypography(result, across, { domain: 'paragraph', property: 'list', value: { kind: 'ordered', level: 1 } }).document
    result = applyTypography(result, across, { domain: 'paragraph', property: 'direction', value: 'rtl' }).document
    expect(result.paragraphs.every(p => p.properties.spacingAfter === 16 && p.properties.list?.kind === 'ordered')).toBe(true)
    expect(resolveParagraphProperty(result, across, 'indent')).toEqual({ state: 'value', value: 24 })
    expect(parse(serializeStudioText(result))).toEqual(result)
  })

  it('rejects unsafe links and malformed tagged maps', () => {
    const document = parse(markup('Link'))
    for (const url of ['javascript:alert(1)', '//evil.example', 'https://example.com/\n'])
      expect(() => applyTypography(document, { mode: 'textRange', textId: 'm5', anchor: { paragraph: 0, grapheme: 0 }, focus: { paragraph: 0, grapheme: 4 } }, { domain: 'link', value: url })).toThrow()
    expect(parseStudioText(markup('<StudioRun font-axes="{&quot;longtag&quot;:1}">Bad</StudioRun>').replace('Variable', ''))).toMatchObject({ ok: false })
  })
})
