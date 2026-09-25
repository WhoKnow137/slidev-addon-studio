import type { ResolvedSlidevOptions } from '@slidev/types'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StudioTextService } from '../node/studio-text-service'

const text = (id: string, content: string) => `<StudioText version="1" id="${id}" pos="1,2,300,auto" resize="auto-height" :font-size="64">${content}</StudioText>`
const fixture = `---\ntitle: Source stability\n---\n\nOrdinary Markdown.\n\n${text('alpha', 'Hello world')}\n\n<OtherBox label="unchanged" />\n\n<!--\nSpeaker notes unchanged.\n-->\n\n${text('beta', 'Hello world')}\n`
const selected = { mode: 'textRange' as const, textId: 'alpha', anchor: { paragraph: 0, grapheme: 6 }, focus: { paragraph: 0, grapheme: 11 } }
let dir: string
let path: string
let service: StudioTextService
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const read = async () => readFile(path, 'utf8')
const command = (expectedRevision: string, property: 'color' | 'fontSize' = 'color', value: string | number = '#ff0000', session = 'test-session') =>
  service.command({ action: 'format', no: 1, id: 'alpha', session, expectedRevision, selection: selected, property, value })

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'studio-text-m1-'))
  path = join(dir, 'imported.md')
  await writeFile(path, fixture)
  service = new StudioTextService({ data: { slides: [{ source: { filepath: path, index: 0 } }] } } as unknown as ResolvedSlidevOptions)
})
afterEach(async () => rm(dir, { recursive: true, force: true }))

describe('guarded StudioText transactions', () => {
  it('resolves imported file, changes only one subtree, and preserves notes and other bytes', async () => {
    const status = await service.status(1, 'alpha', 'test-session')
    expect(status.editable).toBe(true)
    expect(status.handle.filePath).toBe(await realpath(path))
    expect(status.handle.expectedRevision).toBe(hash(fixture))
    const result = await command(status.handle.expectedRevision)
    const source = await read()
    expect(result.noOp).toBe(false)
    expect(source).toBe(fixture.replace(text('alpha', 'Hello world'), text('alpha', 'Hello <StudioRun color="#ff0000">world</StudioRun>')
      .replace(' resize="auto-height" :font-size="64"', ' resize="auto-height" :rotate="0" font-family="sans-serif" :font-size="64" font-weight="400" font-style="normal" color="#ffffff" line-height="normal" letter-spacing="0" align="left" vertical-align="top"')))
    expect(source.slice(0, fixture.indexOf('<StudioText'))).toBe(fixture.slice(0, fixture.indexOf('<StudioText')))
    expect(source.slice(source.indexOf('</StudioText>') + 13)).toBe(fixture.slice(fixture.indexOf('</StudioText>') + 13))
    expect(source).toContain('Speaker notes unchanged.')
  })

  it('refuses stale writes without history and serializes simultaneous writes', async () => {
    const revision = hash(fixture)
    const [first, second] = await Promise.allSettled([command(revision), command(revision, 'fontSize', 72)])
    expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected'])
    expect((first.status === 'rejected' ? first.reason : second.status === 'rejected' ? second.reason : null)?.status).toBe(409)
    const after = await read()
    expect(after).not.toBe(fixture)
    await expect(command(revision)).rejects.toMatchObject({ status: 409 })
    expect(await read()).toBe(after)
    const history = await service.status(1, 'alpha', 'test-session')
    expect(history.canUndo).toBe(true)
  })

  it('undoes and redoes through guarded revisions, and external edits block stale undo', async () => {
    const color = await command(hash(fixture))
    const colorSource = await read()
    const size = await command(color.revision, 'fontSize', 72)
    expect(await read()).toContain('font-size="72" color="#ff0000">world')
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'test-session', expectedRevision: size.revision })
    expect(await read()).toBe(colorSource)
    const redone = await service.command({ action: 'redo', no: 1, id: 'alpha', session: 'test-session', expectedRevision: undone.revision })
    expect(await read()).toContain('font-size="72" color="#ff0000">world')
    await writeFile(path, `${await read()}\nExternal edit.\n`)
    const external = await read()
    await expect(service.command({ action: 'undo', no: 1, id: 'alpha', session: 'test-session', expectedRevision: redone.revision })).rejects.toMatchObject({ status: 409 })
    expect(await read()).toBe(external)
  })

  it('preserves bytes and history for unsupported source, ambiguous IDs and no-op edits', async () => {
    const noOp = await command(hash(fixture), 'fontSize', 64)
    expect(noOp.noOp).toBe(true)
    expect(await read()).toBe(fixture)
    expect((await service.status(1, 'alpha', 'test-session')).canUndo).toBe(false)
    const externallyEdited = `${fixture}\nExternal edit.\n`
    await writeFile(path, externallyEdited)
    await expect(command(hash(fixture))).rejects.toMatchObject({ status: 409 })
    expect(await read()).toBe(externallyEdited)
    expect((await service.status(1, 'alpha', 'test-session')).canUndo).toBe(false)
    const unsupported = fixture.replace('Hello world', 'Hello <SomeComponent /> world')
    await writeFile(path, unsupported)
    expect((await service.status(1, 'alpha')).reason).toContain('Unsupported nested element')
    await expect(command(hash(unsupported))).rejects.toMatchObject({ status: 422 })
    expect(await read()).toBe(unsupported)
    await writeFile(path, `${fixture}\n${text('alpha', 'Duplicate')}`)
    const duplicate = await read()
    await expect(command(hash(duplicate))).rejects.toMatchObject({ status: 409 })
    expect(await read()).toBe(duplicate)
    await writeFile(path, fixture)
    expect((await service.status(1, 'alpha', 'test-session')).canUndo).toBe(false)
  })

  it('makes a second identical save byte-stable and refuses invalid command values', async () => {
    const first = await command(hash(fixture))
    const after = await read()
    const second = await command(first.revision)
    expect(second.noOp).toBe(true)
    expect(second.revision).toBe(first.revision)
    expect(await read()).toBe(after)
    await expect(command(first.revision, 'color', '<script>')).rejects.toThrow('Invalid color')
    expect(await read()).toBe(after)
    const undo = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'test-session', expectedRevision: first.revision })
    expect(undo.noOp).toBe(false)
    expect(await read()).toBe(fixture)
  })
})
