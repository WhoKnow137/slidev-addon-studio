import { describe, expect, it } from 'vitest'
import { graphemes, normalizeText, parseStudioText, serializeStudioText, setCharacterProperty, studioTextSpans, uniqueStudioText } from '../shared/studiotext'

const tag = (body: string, extra = '') => `<StudioText version="1" id="alpha" pos="1,2,300,auto" resize="auto-height" :rotate="0" font-family="Inter" :font-size="64" color="#ffffff" ${extra}>${body}</StudioText>`
function model(source: string) {
  const result = parseStudioText(source)
  if (!result.ok) throw new Error(result.reason)
  return result.document
}

describe('StudioText v1 grammar and model', () => {
  it('parses direct text, entities, Unicode, soft breaks, runs and paragraphs', () => {
    const plain = model(tag('Fish &amp; chips<br />🧵 é हिन्दी שלום'))
    expect(plain.paragraphs[0].runs.map(run => run.text).join('')).toBe('Fish & chips\n🧵 é हिन्दी שלום')
    expect(plain.paragraphs[0].runs.every(run => Object.keys(run.overrides).length === 0)).toBe(true)
    const rich = model(tag('<StudioParagraph align="left">Hello <StudioRun color="#ff3344" :font-size="72">world</StudioRun></StudioParagraph><StudioParagraph align="center">Again.</StudioParagraph>'))
    expect(rich.paragraphs).toHaveLength(2)
    expect(rich.paragraphs[0].runs[1]).toEqual({ text: 'world', overrides: { fontSize: 72, color: '#ff3344' } })
    expect(rich.paragraphs[1].properties.align).toBe('center')
    expect(model(serializeStudioText(rich))).toEqual(normalizeText(rich))
  })

  it('finds exact spans by stable ID with repeated text, adjacent objects and multiline tags', () => {
    const source = `---\ntitle: One\n---\n\n${tag('Same')}<StudioText\n version="1" id="beta" pos="2,2,auto,auto" resize="auto-width">Same</StudioText>\n\n<OtherBox />\n\n<!-- notes -->`
    const spans = studioTextSpans(source)
    expect(spans.map(span => span.id)).toEqual(['alpha', 'beta'])
    expect(spans[0].end).toBe(spans[1].start)
    expect(source.slice(spans[0].start, spans[0].end)).toBe(tag('Same'))
    expect(uniqueStudioText(source, 'beta').source).toContain('id="beta"')
    expect(() => uniqueStudioText(`${source}\n${tag('Again')}`, 'alpha')).toThrow('Ambiguous')
  })

  it('rejects unsupported editable grammar without rewriting it', () => {
    for (const source of [
      tag('Hello', ':font-size="size"'), tag('Hello', 'v-if="true"'), tag('Hello <SomeComponent />'),
      tag('Hello <span style="color:red">world</span>'), tag('Hello {{ name }}'),
      tag('<StudioRun><StudioRun>nested</StudioRun></StudioRun>'), tag('Hello', 'unknown="x"'),
    ]) expect(parseStudioText(source).ok).toBe(false)
  })

  it('splits only selected graphemes and normalizes touched runs', () => {
    const source = tag('Hello world')
    const before = model(source)
    const selected = { anchor: { paragraph: 0, grapheme: 6 }, focus: { paragraph: 0, grapheme: 11 } }
    const colored = setCharacterProperty(before, selected, 'color', '#ff0000')
    expect(colored.paragraphs[0].runs).toEqual([
      { text: 'Hello ', overrides: {} }, { text: 'world', overrides: { color: '#ff0000' } },
    ])
    const sized = setCharacterProperty(colored, selected, 'fontSize', 72)
    expect(sized.paragraphs[0].runs[1].overrides).toEqual({ color: '#ff0000', fontSize: 72 })
    const serialized = serializeStudioText(sized)
    expect(serialized).toContain('Hello <StudioRun font-size="72" color="#ff0000">world</StudioRun>')
    expect(model(serialized)).toEqual(sized)
    expect(serializeStudioText(sized)).toBe(serialized)
  })

  it('removes empties and inherited overrides, merges equal neighbors within paragraphs only', () => {
    const doc = model(tag('<StudioParagraph align="left"><StudioRun color="#ff0000">A</StudioRun><StudioRun color="#ff0000">B</StudioRun><StudioRun color="#ffffff"></StudioRun></StudioParagraph><StudioParagraph align="left">C</StudioParagraph>'))
    const normalized = normalizeText(doc)
    expect(normalized.paragraphs[0].runs).toEqual([{ text: 'AB', overrides: { color: '#ff0000' } }])
    expect(normalized.paragraphs[1].runs).toEqual([{ text: 'C', overrides: {} }])
  })

  it('uses grapheme clusters for all required Unicode cases', () => {
    for (const unit of ['A', 'é', 'é', '🧵', '👍🏽', '👨‍👩‍👧‍👦', '🇨🇦', '𝄞']) expect(graphemes(unit)).toHaveLength(1)
    const text = 'A👨‍👩‍👧‍👦B'
    const doc = model(tag(text))
    const changed = setCharacterProperty(doc, { anchor: { paragraph: 0, grapheme: 1 }, focus: { paragraph: 0, grapheme: 2 } }, 'color', '#ff0000')
    expect(changed.paragraphs[0].runs).toEqual([
      { text: 'A', overrides: {} }, { text: '👨‍👩‍👧‍👦', overrides: { color: '#ff0000' } }, { text: 'B', overrides: {} },
    ])
  })

  it('escapes text on serialization without adding visible indentation', () => {
    const doc = model(tag('A &amp; B &lt; C &gt; D'))
    const serialized = serializeStudioText(doc)
    expect(serialized).toContain('>A &amp; B &lt; C &gt; D</StudioText>')
    expect(model(serialized).paragraphs[0].runs[0].text).toBe('A & B < C > D')
  })

  it('preserves object alignment while keeping simple text direct', () => {
    const source = tag('Centered', 'align="center"')
    const doc = model(source)
    expect(doc.align).toBe('center')
    const serialized = serializeStudioText(doc)
    expect(serialized).toContain('align="center"')
    expect(serialized).toContain('>Centered</StudioText>')
    expect(serialized).not.toContain('StudioParagraph')
    expect(model(serialized)).toEqual(normalizeText(doc))
  })

  it('keeps a semantic no-op byte stable even if untouched runs are not normalized', () => {
    const source = tag('<StudioRun color="#ff0000">Hello </StudioRun><StudioRun color="#ff0000">world</StudioRun>')
    const doc = model(source)
    const same = setCharacterProperty(doc, { anchor: { paragraph: 0, grapheme: 6 }, focus: { paragraph: 0, grapheme: 11 } }, 'color', '#ff0000')
    expect(same).toBe(doc)
    expect(source).toContain('Hello </StudioRun><StudioRun')
  })
})
