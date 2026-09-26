import type { ResolvedSlidevOptions } from '@slidev/types'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StudioTextService } from '../node/studio-text-service'
import { TextStyleService } from '../node/text-style-service'
import { parseStudioText, serializeStudioText } from '../shared/studiotext'
import { applyTextStyle, detachTextStyle, parseTextStyles, resolveTextStyle, serializeTextStyles } from '../shared/text-styles'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const object = (id: string) => ({ mode: 'objects' as const, ids: [id] })
const markup = (id: string) => `<StudioText version="1" id="${id}" pos="0,0,300,auto" resize="auto-height" font-family="Original" :font-size="32">Hello</StudioText>`
const fixture = `---\ntitle: Styles\n---\n\n${markup('one')}\n\n${markup('two')}\n`
const hero = { id: 'heading/hero', name: 'Heading / Hero', character: { fontFamily: 'Inter Tight', fontSize: 64, color: '#ffffff' },
  paragraph: { spacingAfter: 16, direction: 'ltr' as const } }
let dir: string
let path: string
let text: StudioTextService
let styles: TextStyleService
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'studio-m5-style-'))
  path = join(dir, 'slides.md')
  await writeFile(path, fixture)
  const options = { userRoot: dir, data: { slides: [{ source: { filepath: path, index: 0 } }] } } as unknown as ResolvedSlidevOptions
  text = new StudioTextService(options)
  styles = new TextStyleService(options)
})
afterEach(async () => rm(dir, { recursive: true, force: true }))

describe('M5 shared text styles', () => {
  it('serializes equivalent resource maps in the same order', () => {
    const a = { version: 1 as const, styles: [{ ...hero, character: { fontFamily: 'Inter', fontSize: 32 }, paragraph: { indent: 2, spacingAfter: 4 } }] }
    const b = { version: 1 as const, styles: [{ ...hero, character: { fontSize: 32, fontFamily: 'Inter' }, paragraph: { spacingAfter: 4, indent: 2 } }] }
    expect(serializeTextStyles(a)).toBe(serializeTextStyles(b))
  })
  it('round trips an explicit no-list shared paragraph override', () => {
    expect(parseTextStyles({ version: 1, styles: [{ ...hero, paragraph: { list: null } }] }).styles[0].paragraph.list).toBeNull()
  })
  it('resolves shared values, local overrides, and detach without changing the visual model', () => {
    const parsed = parseStudioText(markup('one'))
    if (!parsed.ok) throw Error(parsed.reason)
    const catalog = parseTextStyles({ version: 1, styles: [hero] })
    const attached = applyTextStyle(parsed.document, hero.id, catalog)
    expect(attached.defaults.fontFamily).toBe('Inter Tight')
    expect(attached.paragraphs[0].properties.spacingAfter).toBe(16)
    const source = serializeStudioText(attached)
    expect(source).toContain('style-ref="heading/hero"')
    expect(source).not.toContain('font-family="Inter Tight"')
    const reloaded = parseStudioText(source)
    if (!reloaded.ok) throw Error(reloaded.reason)
    expect(resolveTextStyle(reloaded.document, catalog)).toEqual(attached)
    const detached = detachTextStyle(attached, catalog)
    expect(detached.styleRef).toBeUndefined()
    expect(detached.defaults).toEqual(attached.defaults)
    expect(detached.paragraphs).toEqual(attached.paragraphs)
    expect(parseStudioText(serializeStudioText(detached))).toMatchObject({ ok: true })
  })

  it('updates two references while preserving a local override, then undoes the resource edit', async () => {
    const initial = await styles.status('style-session')
    const created = await styles.command({ action: 'upsert', session: 'style-session', expectedRevision: initial.revision, style: hero })
    let source = await readFile(path, 'utf8')
    for (const id of ['one', 'two']) {
      const current = await text.status(1, id, 'text-session')
      const result = await text.command({ action: 'style', no: 1, id, session: 'text-session',
        expectedRevision: current.handle.expectedRevision, selection: object(id), styleEdit: { kind: 'apply', id: hero.id } })
      expect(result.document.styleRef).toBe(hero.id)
      source = await readFile(path, 'utf8')
    }
    expect(source.match(/style-ref="heading\/hero"/g)).toHaveLength(2)
    const first = await text.status(1, 'one', 'text-session')
    const override = await text.command({ action: 'typography', no: 1, id: 'one', session: 'text-session',
      expectedRevision: first.handle.expectedRevision, selection: object('one'),
      edit: { domain: 'character', property: 'color', value: '#ff0000' } })
    expect(override.document.localDefaults?.color).toBe('#ff0000')
    expect(await readFile(path, 'utf8')).toContain('color="#ff0000"')
    const updated = await styles.command({ action: 'upsert', session: 'style-session', expectedRevision: created.revision,
      style: { ...hero, character: { ...hero.character, fontSize: 72, color: '#00ff00' } } })
    expect((await text.status(1, 'one')).document?.defaults).toMatchObject({ fontSize: 72, color: '#ff0000' })
    expect((await text.status(1, 'two')).document?.defaults).toMatchObject({ fontSize: 72, color: '#00ff00' })
    const second = await text.status(1, 'two', 'text-session')
    const detached = await text.command({ action: 'style', no: 1, id: 'two', session: 'text-session',
      expectedRevision: second.handle.expectedRevision, selection: object('two'), styleEdit: { kind: 'detach' } })
    expect(detached.document.styleRef).toBeUndefined()
    expect(detached.document.defaults.fontSize).toBe(72)
    const revision = sha(await readFile(path, 'utf8'))
    expect(revision).toBe(detached.revision)
    const undone = await styles.command({ action: 'undo', session: 'style-session', expectedRevision: updated.revision })
    expect((await text.status(1, 'one')).document?.defaults.fontSize).toBe(64)
    expect((await text.status(1, 'two')).document?.defaults.fontSize).toBe(72)
    await expect(styles.command({ action: 'upsert', session: 'style-session', expectedRevision: updated.revision,
      style: hero })).rejects.toMatchObject({ status: 409 })
    expect(undone.canRedo).toBe(true)
  })
})
