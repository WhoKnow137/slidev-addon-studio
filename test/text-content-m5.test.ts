import type { ResolvedSlidevOptions } from '@slidev/types'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StudioTextService } from '../node/studio-text-service'
import { parseStudioText, serializeStudioText } from '../shared/studiotext'
import { replaceText } from '../shared/text-content'

const text = `<StudioText version="1" id="ime" pos="0,0,300,auto" resize="auto-height" font-family="Inter" :font-size="32"><StudioParagraph direction="rtl">English العربية English</StudioParagraph><StudioParagraph>עברית + 123 + English</StudioParagraph><StudioParagraph>é🇨🇦👩‍💻</StudioParagraph></StudioText>`
function doc() { const p = parseStudioText(text); if (!p.ok) throw Error(p.reason); return p.document }
let dir: string
let path: string
let service: StudioTextService
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'studio-m5-ime-'))
  path = join(dir, 'slides.md')
  await writeFile(path, text)
  service = new StudioTextService({ data: { slides: [{ source: { filepath: path, index: 0 } }] } } as unknown as ResolvedSlidevOptions)
})
afterEach(async () => rm(dir, { recursive: true, force: true }))

describe('M5 logical text insertion and composition commit', () => {
  it.each(['日本語', '中文拼音', '한국어'])('commits one %s composition as one guarded transaction', async (inserted) => {
    const selection = { mode: 'textCaret' as const, textId: 'ime', at: { paragraph: 2, grapheme: 1 } }
    const initial = createHash('sha256').update(text).digest('hex')
    // Intermediate compositionupdate values are local; only the final value is sent.
    const final = await service.command({ action: 'content', no: 1, id: 'ime', session: 'ime-session',
      expectedRevision: initial, selection, content: inserted })
    const after = await readFile(path, 'utf8')
    expect(after).toContain(`é${inserted}🇨🇦👩‍💻`)
    expect(final.selection).toEqual({ mode: 'textCaret', textId: 'ime', at: { paragraph: 2, grapheme: 1 + [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(inserted)].length } })
    const undone = await service.command({ action: 'undo', no: 1, id: 'ime', session: 'ime-session', expectedRevision: final.revision })
    expect(await readFile(path, 'utf8')).toBe(text)
    await service.command({ action: 'redo', no: 1, id: 'ime', session: 'ime-session', expectedRevision: undone.revision })
    expect(await readFile(path, 'utf8')).toBe(after)
  })

  it('replaces a mixed bidi range without reordering source or splitting emoji graphemes', () => {
    const selection = { mode: 'textRange' as const, textId: 'ime',
      anchor: { paragraph: 0, grapheme: 8 }, focus: { paragraph: 1, grapheme: 6 } }
    const result = replaceText(doc(), selection, 'שלום')
    expect(result.document.paragraphs).toHaveLength(2)
    expect(result.document.paragraphs[0].properties.direction).toBe('rtl')
    expect(result.document.paragraphs[0].runs.map(run => run.text).join('')).toContain('שלום')
    expect(parseStudioText(serializeStudioText(result.document))).toMatchObject({ ok: true })
  })

  it('rejects stale content writes and preserves source', async () => {
    const selection = { mode: 'textCaret' as const, textId: 'ime', at: { paragraph: 2, grapheme: 1 } }
    await expect(service.command({ action: 'content', no: 1, id: 'ime', session: 'ime-session',
      expectedRevision: '0'.repeat(64), selection, content: 'あ' })).rejects.toMatchObject({ status: 409 })
    expect(await readFile(path, 'utf8')).toBe(text)
  })
})
