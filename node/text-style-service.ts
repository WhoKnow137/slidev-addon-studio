import type { ResolvedSlidevOptions } from '@slidev/types'
import type { StudioTextStyleFile } from '../shared/text-styles'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { EMPTY_TEXT_STYLES, parseTextStyles, serializeTextStyles } from '../shared/text-styles'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const empty = Buffer.alloc(0)
export function textStylePath(options: Pick<ResolvedSlidevOptions, 'userRoot'>): string {
  return join(options.userRoot, 'public', 'studio-text-styles.json')
}
async function current(path: string): Promise<Buffer> {
  try { return await readFile(path) }
  catch (error: any) { if (error.code === 'ENOENT') return empty; throw error }
}
export async function readTextStyles(options: Pick<ResolvedSlidevOptions, 'userRoot'>): Promise<{ revision: string, file: StudioTextStyleFile }> {
  if (!options.userRoot) return { revision: sha(empty), file: EMPTY_TEXT_STYLES }
  const bytes = await current(textStylePath(options))
  return { revision: sha(bytes), file: bytes.length ? parseTextStyles(JSON.parse(bytes.toString('utf8'))) : EMPTY_TEXT_STYLES }
}
interface Entry { before: Buffer, after: Buffer, beforeRevision: string, afterRevision: string }
interface History { undo: Entry[], redo: Entry[] }
export class TextStyleService {
  private tail: Promise<void> = Promise.resolve()
  private history = new Map<string, History>()
  constructor(private options: ResolvedSlidevOptions) {}
  async status(session?: string) {
    const result = await readTextStyles(this.options)
    const history = session ? this.history.get(session) : undefined
    return { ...result, canUndo: !!history?.undo.length, canRedo: !!history?.redo.length }
  }
  private async write(expected: string, candidate: Buffer) {
    const path = textStylePath(this.options)
    const before = await current(path)
    if (sha(before) !== expected) throw Object.assign(Error('stale-style-revision'), { status: 409 })
    if (before.equals(candidate)) return expected
    await mkdir(dirname(path), { recursive: true })
    const temp = join(dirname(path), `.studio-text-style-${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(temp, 'wx')
      await handle.writeFile(candidate)
      await handle.sync()
      await handle.close(); handle = null
      if (sha(await current(path)) !== expected) throw Object.assign(Error('stale-style-revision'), { status: 409 })
      await rename(temp, path)
    }
    finally { if (handle) await handle.close(); await rm(temp, { force: true }) }
    return sha(candidate)
  }
  async command(payload: { action: 'upsert' | 'undo' | 'redo', session: string, expectedRevision: string,
    style?: StudioTextStyleFile['styles'][number] }) {
    const prior = this.tail
    let release!: () => void
    this.tail = prior.then(() => new Promise<void>(resolve => { release = resolve }))
    await prior
    try {
      if (!/^[a-zA-Z0-9-]{8,100}$/.test(payload.session)
        || !/^[0-9a-f]{64}$/.test(payload.expectedRevision)) throw Error('Invalid style transaction')
      const path = textStylePath(this.options)
      const before = await current(path)
      if (sha(before) !== payload.expectedRevision) throw Object.assign(Error('stale-style-revision'), { status: 409 })
      const file = before.length ? parseTextStyles(JSON.parse(before.toString('utf8'))) : EMPTY_TEXT_STYLES
      const history = this.history.get(payload.session) ?? { undo: [], redo: [] }
      this.history.set(payload.session, history)
      if (payload.action === 'upsert') {
        if (!payload.style) throw Error('Missing style definition')
        const existing = file.styles.filter(item => item.id !== payload.style!.id)
        const next = parseTextStyles({ version: 1, styles: [...existing, payload.style] })
        const candidate = Buffer.from(serializeTextStyles(next))
        const revision = await this.write(payload.expectedRevision, candidate)
        if (revision !== payload.expectedRevision) {
          history.undo.push({ before, after: candidate, beforeRevision: payload.expectedRevision, afterRevision: revision })
          history.redo = []
        }
        return { file: next, revision, noOp: revision === payload.expectedRevision,
          canUndo: !!history.undo.length, canRedo: !!history.redo.length }
      }
      if (payload.action !== 'undo' && payload.action !== 'redo') throw Error('Unknown style action')
      const from = payload.action === 'undo' ? history.undo : history.redo
      const to = payload.action === 'undo' ? history.redo : history.undo
      const entry = from.at(-1)
      if (!entry || !before.equals(payload.action === 'undo' ? entry.after : entry.before))
        throw Object.assign(Error('stale-style-history'), { status: 409 })
      const candidate = payload.action === 'undo' ? entry.before : entry.after
      const revision = await this.write(payload.expectedRevision, candidate)
      from.pop()
      if (payload.action === 'undo') entry.beforeRevision = revision
      else entry.afterRevision = revision
      to.push(entry)
      return { file: candidate.length ? parseTextStyles(JSON.parse(candidate.toString('utf8'))) : EMPTY_TEXT_STYLES,
        revision, noOp: false, canUndo: !!history.undo.length, canRedo: !!history.redo.length }
    }
    finally { release() }
  }
}
