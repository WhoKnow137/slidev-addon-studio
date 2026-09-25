import type { ResolvedSlidevOptions } from '@slidev/types'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StudioTextService } from '../node/studio-text-service'
import type { GeometryEdit } from '../shared/geometry'

const fixture = `---\ntitle: Geometry\n---\n\nText before.\n\n<StudioText version="1" id="alpha" pos="100,80,400,200" resize="fixed" :rotate="0" :font-size="48" font-family="Inter">Hello <StudioRun font-size="72">world</StudioRun></StudioText>\n\n<OtherBox />\n\n<!-- Synthetic speaker notes. -->\n\n<StudioText version="1" id="beta" pos="600,80,400,200" resize="fixed" :font-size="32">Other text</StudioText>\n`
const hash = (source: string) => createHash('sha256').update(source).digest('hex')
const selection = { mode: 'objects' as const, ids: ['alpha'] }
const measurement = { width: 400, height: 200 }
let dir: string; let file: string; let service: StudioTextService
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'studio-geometry-'))
  file = join(dir, 'slide.md')
  await writeFile(file, fixture)
  service = new StudioTextService({ data: { slides: [{ source: { filepath: file, index: 0 } }] } } as unknown as ResolvedSlidevOptions)
})
afterEach(async () => rm(dir, { recursive: true, force: true }))
const read = () => readFile(file, 'utf8')
const command = (edit: GeometryEdit, revision: string) => service.command({ action: 'geometry', no: 1, id: 'alpha',
  session: 'geometry-session', expectedRevision: revision, selection, geometryEdit: edit })

describe('M3 guarded geometry transactions', () => {
  it.each([
    { kind: 'set', property: 'x', value: 150 }, { kind: 'set', property: 'y', value: -25.25 },
    { kind: 'set', property: 'width', value: 800 }, { kind: 'set', property: 'height', value: 400 },
    { kind: 'set', property: 'rotationDeg', value: -45 },
    { kind: 'translate', dx: 50, dy: -10 },
    { kind: 'resize', handle: 'se', dx: 400, dy: 200, measurement },
    { kind: 'mode', mode: 'auto-height' },
    { kind: 'scale', factor: 2, measurement },
  ] as GeometryEdit[])('$kind commits once, reparses, undoes, and redoes', async (edit) => {
    const first = await command(edit, hash(fixture))
    const after = await read()
    expect(after).not.toBe(fixture)
    expect(after.slice(0, after.indexOf('<StudioText'))).toBe(fixture.slice(0, fixture.indexOf('<StudioText')))
    expect(after.slice(after.indexOf('</StudioText>') + 13)).toBe(fixture.slice(fixture.indexOf('</StudioText>') + 13))
    expect((await service.status(1, 'alpha')).document).not.toBeNull()
    if (edit.kind !== 'scale') expect(after.replace(/pos="[^"]*"|resize="[^"]*"|(?::)?rotate="[^"]*"/g, ''))
      .toBe(fixture.replace(/pos="[^"]*"|resize="[^"]*"|(?::)?rotate="[^"]*"/g, ''))
    const undone = await service.command({ action: 'undo', no: 1, id: 'alpha', session: 'geometry-session', expectedRevision: first.revision })
    expect(await read()).toBe(fixture)
    await service.command({ action: 'redo', no: 1, id: 'alpha', session: 'geometry-session', expectedRevision: undone.revision })
    expect(await read()).toBe(after)
  })

  it('refuses stale gesture commit and leaves source/history unchanged', async () => {
    const starting = hash(fixture)
    const external = `${fixture}\nExternal edit during drag.\n`
    await writeFile(file, external)
    await expect(command({ kind: 'translate', dx: 100, dy: 0 }, starting)).rejects.toMatchObject({ status: 409 })
    expect(await read()).toBe(external)
    expect((await service.status(1, 'alpha', 'geometry-session')).canUndo).toBe(false)
  })

  it('refuses stale undo after an external source edit', async () => {
    const first = await command({ kind: 'translate', dx: 10, dy: 0 }, hash(fixture))
    const external = `${await read()}\nExternal edit.\n`
    await writeFile(file, external)
    await expect(service.command({ action: 'undo', no: 1, id: 'alpha', session: 'geometry-session', expectedRevision: first.revision }))
      .rejects.toMatchObject({ status: 409 })
    expect(await read()).toBe(external)
  })

  it('preserves affine source and refuses geometry with no history', async () => {
    const affine = fixture.replace('resize="fixed" :rotate="0"', 'resize="fixed" affine="1,0,0,1,5,6" :rotate="0"')
    await writeFile(file, affine)
    await expect(command({ kind: 'translate', dx: 10, dy: 0 }, hash(affine))).rejects.toMatchObject({ status: 422 })
    expect(await read()).toBe(affine)
    expect((await service.status(1, 'alpha', 'geometry-session')).canUndo).toBe(false)
  })

  it('moves two objects in one atomic same-slide transaction and reverses both', async () => {
    const first = await service.command({ action: 'geometry-batch', no: 1, id: 'alpha', ids: ['alpha', 'beta'],
      session: 'geometry-session', expectedRevision: hash(fixture),
      selection: { mode: 'objects', ids: ['alpha', 'beta'] },
      geometryEdit: { kind: 'translate', dx: 50, dy: -10 } })
    const after = await read()
    expect(after).toContain('id="alpha" pos="150,70,400,200"')
    expect(after).toContain('id="beta" pos="650,70,400,200"')
    expect(after).toContain('Synthetic speaker notes.')
    expect((await service.status(1, 'beta', 'geometry-session')).canUndo).toBe(true)
    const undone = await service.command({ action: 'undo', no: 1, id: 'beta', session: 'geometry-session', expectedRevision: first.revision })
    expect(await read()).toBe(fixture)
    await service.command({ action: 'redo', no: 1, id: 'beta', session: 'geometry-session', expectedRevision: undone.revision })
    expect(await read()).toBe(after)
  })

  it('sets mixed X to one value for both objects and refuses a conflicting second object atomically', async () => {
    const setX = await service.command({ action: 'geometry-batch', no: 1, id: 'alpha', ids: ['alpha', 'beta'],
      session: 'geometry-session', expectedRevision: hash(fixture),
      selection: { mode: 'objects', ids: ['alpha', 'beta'] },
      geometryEdit: { kind: 'set', property: 'x', value: 300 } })
    expect((await read()).match(/pos="300,80,400,200"/g)).toHaveLength(2)
    const changed = (await read()).replace('id="beta" pos=', 'id="beta" affine="1,0,0,1,5,6" pos=')
    await writeFile(file, changed)
    await expect(service.command({ action: 'geometry-batch', no: 1, id: 'alpha', ids: ['alpha', 'beta'],
      session: 'other-session', expectedRevision: hash(changed), selection: { mode: 'objects', ids: ['alpha', 'beta'] },
      geometryEdit: { kind: 'translate', dx: 10, dy: 0 } })).rejects.toMatchObject({ status: 422 })
    expect(await read()).toBe(changed)
    expect((await service.status(1, 'alpha', 'other-session')).canUndo).toBe(false)
    expect(setX.noOp).toBe(false)
  })
})
