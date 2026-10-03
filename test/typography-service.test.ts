import type { ResolvedSlidevOptions } from '@slidev/types'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EditableCharacterProperty, StudioSelection } from '../shared/studiotext'
import { StudioTextService } from '../node/studio-text-service'

const object = { mode: 'objects' as const, ids: ['alpha'] }
const range = { mode: 'textRange' as const, textId: 'alpha',
  anchor: { paragraph: 0, grapheme: 6 }, focus: { paragraph: 0, grapheme: 11 } }
const caret = { mode: 'textCaret' as const, textId: 'alpha', at: { paragraph: 0, grapheme: 6 } }
const fixture = `---\ntitle: untouched\n---\n\nOrdinary Markdown.\n\n<StudioText version="1" id="alpha" pos="1,2,300,auto" resize="auto-height" :font-size="64">Hello world</StudioText>\n\n<OtherBox />\n\n<!--\nSpeaker notes unchanged.\n-->\n\n<StudioText version="1" id="beta" pos="1,3,300,auto" resize="auto-height">Other text</StudioText>\n`
const hash = (source: string) => createHash('sha256').update(source).digest('hex')
const characterCases: [EditableCharacterProperty, string | number][] = [
  ['fontFamily', 'Helvetica Neue'], ['fontWeight', 600], ['fontStyle', 'italic'], ['fontSize', 72.5],
  ['color', '#112233aa'], ['lineHeight', '1.2'], ['letterSpacing', '-1.5px'],
  ['decoration', 'underline line-through'], ['textCase', 'uppercase'],
]
let dir: string
let path: string
let service: StudioTextService
const read = () => readFile(path, 'utf8')
const command = (selection: StudioSelection, edit: any, revision: string, session = 'm2-session') =>
  service.command({ action: 'typography', no: 1, id: 'alpha', session, expectedRevision: revision, selection, edit })
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'studio-text-m2-'))
  path = join(dir, 'slide.md')
  await writeFile(path, fixture)
  service = new StudioTextService({ data: { slides: [{ source: { filepath: path, index: 0 } }] } } as unknown as ResolvedSlidevOptions)
})
afterEach(async () => rm(dir, { recursive: true, force: true }))

describe('M2 guarded typography transactions', () => {
  it.each(characterCases)('%s preserves unrelated bytes and supports range undo/redo', async (property, value) => {
    const edit = { domain: 'character', property, value }
    const first = await command(range, edit, hash(fixture))
    const after = await read()
    expect(after).not.toBe(fixture)
    expect(after.slice(0, after.indexOf('<StudioText'))).toBe(fixture.slice(0, fixture.indexOf('<StudioText')))
    expect(after.slice(after.indexOf('</StudioText>') + 13)).toBe(fixture.slice(fixture.indexOf('</StudioText>') + 13))
    expect(after).toContain('Speaker notes unchanged.')
    const status = await service.status(1, 'alpha', 'm2-session')
    expect(status.document?.paragraphs[0].runs.at(-1)?.overrides[property]).toBe(property === 'lineHeight' ? 1.2 : value)
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: first.revision })
    expect(await read()).toBe(fixture)
    const redone = await service.command({ action: 'redo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: undone.revision })
    expect(await read()).toBe(after)
    expect(redone.canUndo).toBe(true)
  })

  it.each(characterCases)('%s supports object defaults and guarded history', async (property, value) => {
    const first = await command(object, { domain: 'character', property, value }, hash(fixture))
    const after = await read()
    expect((await service.status(1, 'alpha')).document?.defaults[property]).toBe(property === 'lineHeight' ? 1.2 : value)
    expect(after.slice(after.indexOf('</StudioText>') + 13)).toBe(fixture.slice(fixture.indexOf('</StudioText>') + 13))
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: first.revision })
    expect(await read()).toBe(fixture)
    await service.command({ action: 'redo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: undone.revision })
    expect(await read()).toBe(after)
  })

  it.each(characterCases)('%s caret typing style is undoable without writing source', async (property, value) => {
    const first = await command(caret, { domain: 'character', property, value }, hash(fixture))
    expect(first.selection).toMatchObject({ typingStyle: { [property]: property === 'lineHeight' ? 1.2 : value } })
    expect(await read()).toBe(fixture)
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: first.revision })
    expect(undone.selection).toEqual(caret)
    const redone = await service.command({ action: 'redo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: first.revision })
    expect(redone.selection).toEqual(first.selection)
    expect(await read()).toBe(fixture)
  })

  it.each(['bold', 'italic', 'underline', 'strikethrough'] as const)('%s toggle uses guarded range history', async (property) => {
    const first = await command(range, { domain: 'toggle', property }, hash(fixture))
    const after = await read()
    expect(after).not.toBe(fixture)
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: first.revision })
    expect(await read()).toBe(fixture)
    await service.command({ action: 'redo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: undone.revision })
    expect(await read()).toBe(after)
  })

  it('keeps caret styling in the selection transaction with no source write', async () => {
    const result = await command(caret, { domain: 'character', property: 'fontFamily', value: 'Inter Tight' }, hash(fixture))
    expect(result.noOp).toBe(false)
    expect(result.revision).toBe(hash(fixture))
    expect(await read()).toBe(fixture)
    expect(result.selection).toMatchObject({ typingStyle: { fontFamily: 'Inter Tight' } })
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: result.revision })
    expect(undone.selection).toEqual(caret)
    expect(await read()).toBe(fixture)
    const redone = await service.command({ action: 'redo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: result.revision })
    expect(redone.selection).toMatchObject({ typingStyle: { fontFamily: 'Inter Tight' } })
  })

  it('routes object, paragraph and vertical changes through the same history', async () => {
    const family = await command(object, { domain: 'character', property: 'fontFamily', value: 'Inter' }, hash(fixture))
    expect((await service.status(1, 'alpha')).document?.defaults.fontFamily).toBe('Inter')
    expect((await service.status(1, 'beta', 'm2-session')).canUndo).toBe(false)
    const align = await command(object, { domain: 'paragraph', property: 'align', value: 'center' }, family.revision)
    expect((await service.status(1, 'alpha')).document?.align).toBe('center')
    const vertical = await command(range, { domain: 'object', property: 'verticalAlign', value: 'bottom' }, align.revision)
    expect((await service.status(1, 'alpha')).document?.verticalAlign).toBe('bottom')
    await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: vertical.revision })
    expect((await service.status(1, 'alpha')).document?.verticalAlign).toBe('top')
  })

  it.each(['left', 'center', 'right', 'justify'] as const)('paragraph alignment %s reloads and reverses exactly', async (value) => {
    const initial = fixture.replace('resize="auto-height" :font-size="64"',
      `resize="auto-height" :font-size="64" align="${value === 'right' ? 'left' : 'right'}"`)
    await writeFile(path, initial)
    const first = await command(caret, { domain: 'paragraph', property: 'align', value }, hash(initial))
    const after = await read()
    const loaded = (await service.status(1, 'alpha')).document
    expect(loaded?.paragraphs[0].properties.align ?? loaded?.align).toBe(value)
    expect(after.slice(after.indexOf('</StudioText>') + 13)).toBe(initial.slice(initial.indexOf('</StudioText>') + 13))
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: first.revision })
    expect(await read()).toBe(initial)
    await service.command({ action: 'redo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: undone.revision })
    expect(await read()).toBe(after)
  })

  it.each(['top', 'center', 'bottom'] as const)('vertical alignment %s reloads and reverses exactly', async (value) => {
    const initial = fixture.replace('resize="auto-height" :font-size="64"',
      `resize="auto-height" :font-size="64" vertical-align="${value === 'bottom' ? 'top' : 'bottom'}"`)
    await writeFile(path, initial)
    const first = await command(range, { domain: 'object', property: 'verticalAlign', value }, hash(initial))
    const after = await read()
    expect((await service.status(1, 'alpha')).document?.verticalAlign).toBe(value)
    expect(after.slice(after.indexOf('</StudioText>') + 13)).toBe(initial.slice(initial.indexOf('</StudioText>') + 13))
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: first.revision })
    expect(await read()).toBe(initial)
    await service.command({ action: 'redo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: undone.revision })
    expect(await read()).toBe(after)
  })

  it('refuses stale and unsupported source without history or byte changes', async () => {
    await writeFile(path, `${fixture}\nExternal edit.\n`)
    const external = await read()
    await expect(command(object, { domain: 'character', property: 'fontSize', value: 72 }, hash(fixture)))
      .rejects.toMatchObject({ status: 409 })
    expect(await read()).toBe(external)
    expect((await service.status(1, 'alpha', 'm2-session')).canUndo).toBe(false)
    const unsupported = fixture.replace('Hello world', 'Hello <SomeComponent /> world')
    await writeFile(path, unsupported)
    await expect(command(object, { domain: 'character', property: 'fontSize', value: 72 }, hash(unsupported)))
      .rejects.toMatchObject({ status: 422 })
    expect(await read()).toBe(unsupported)
    expect((await service.status(1, 'alpha', 'm2-session')).canUndo).toBe(false)
  })

  it('keeps a second identical typography save byte-stable and out of history', async () => {
    const edit = { domain: 'character', property: 'fontSize', value: 72 }
    const first = await command(range, edit, hash(fixture))
    const after = await read()
    const second = await command(range, edit, first.revision)
    expect(second.noOp).toBe(true)
    expect(second.revision).toBe(first.revision)
    expect(await read()).toBe(after)
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'm2-session', expectedRevision: first.revision })
    expect(await read()).toBe(fixture)
    expect(undone.canUndo).toBe(false)
  })

  it('serializes competing M2 writes and refuses duplicate IDs', async () => {
    const revision = hash(fixture)
    const [first, second] = await Promise.allSettled([
      command(range, { domain: 'character', property: 'fontSize', value: 72 }, revision),
      command(range, { domain: 'character', property: 'color', value: '#ff3344' }, revision),
    ])
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected'])
    expect((first.status === 'rejected' ? first.reason : second.status === 'rejected' ? second.reason : null)?.status).toBe(409)
    const after = await read()
    expect(after).not.toBe(fixture)
    const duplicate = `${fixture}\n<StudioText version="1" id="alpha" pos="1,4,300,auto" resize="auto-height">Duplicate</StudioText>\n`
    await writeFile(path, duplicate)
    await expect(command(object, { domain: 'character', property: 'fontSize', value: 80 }, hash(duplicate), 'fresh-session'))
      .rejects.toMatchObject({ status: 409 })
    expect(await read()).toBe(duplicate)
    await writeFile(path, fixture)
    expect((await service.status(1, 'alpha', 'fresh-session')).canUndo).toBe(false)
  })
})
