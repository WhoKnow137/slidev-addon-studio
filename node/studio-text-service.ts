import type { ResolvedSlidevOptions } from '@slidev/types'
import type { SourceHandle, StudioSelection } from '../shared/studiotext'
import type { TypographyEdit } from '../shared/typography'
import { createHash, randomUUID } from 'node:crypto'
import { open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseStudioText, serializeStudioText, uniqueStudioText } from '../shared/studiotext'
import { applyTypography } from '../shared/typography'
import { splitDeck } from './slide-source'

export class StudioTextError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}
interface HistoryEntry {
  label: string
  filePath: string
  textId: string
  beforeRevision: string
  afterRevision: string
  beforeSource: string
  afterSource: string
  beforeSelection?: StudioSelection
  afterSelection?: StudioSelection
  selectionOnly?: boolean
}
interface SessionHistory { undo: HistoryEntry[], redo: HistoryEntry[] }
const historyFlags = (history: SessionHistory | undefined, filePath: string, id: string) => ({
  canUndo: history?.undo.at(-1)?.filePath === filePath && history.undo.at(-1)?.textId === id,
  canRedo: history?.redo.at(-1)?.filePath === filePath && history.redo.at(-1)?.textId === id,
})
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

function textContent(bytes: Buffer): string {
  const source = bytes.toString('utf8')
  if (!Buffer.from(source, 'utf8').equals(bytes)) throw new StudioTextError('Source is not valid UTF-8')
  return source
}
function byteRange(source: string, start: number, end: number): [number, number] {
  return [Buffer.byteLength(source.slice(0, start)), Buffer.byteLength(source.slice(0, end))]
}
function slideContains(source: string, sourceIndex: number, start: number): boolean {
  // Slidev's source.index is zero based within the authoritative file. The
  // line splitter is shared with the existing deck source editor.
  const lines = source.slice(0, start).split(/\r?\n/).length - 1
  const { slides } = splitDeck(source)
  const slide = slides[sourceIndex]
  return !!slide && lines >= slide.start && lines < slide.end
}

export class StudioTextService {
  private tails = new Map<string, Promise<void>>()
  private history = new Map<string, SessionHistory>()
  constructor(private options: ResolvedSlidevOptions) {}

  private async sourceRef(no: number, id: string) {
    if (!Number.isInteger(no) || no < 1 || typeof id !== 'string' || !id || id.length > 256)
      throw new StudioTextError('Invalid slide or StudioText ID')
    const source = this.options.data.slides[no - 1]?.source
    if (!source?.filepath) throw new StudioTextError('Authoritative slide source unavailable', 404)
    const filePath = await realpath(source.filepath)
    return { filePath, sourceIndex: source.index ?? 0, id }
  }

  private async withFile<T>(filePath: string, task: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(filePath) ?? Promise.resolve()
    let release!: () => void
    const own = new Promise<void>(resolve => (release = resolve))
    const tail = prior.then(() => own)
    this.tails.set(filePath, tail)
    await prior
    try { return await task() }
    finally {
      release()
      if (this.tails.get(filePath) === tail) this.tails.delete(filePath)
    }
  }

  private inspect(source: string, sourceIndex: number, id: string) {
    let span
    try { span = uniqueStudioText(source, id) }
    catch (error) { throw new StudioTextError((error as Error).message, 409) }
    if (!slideContains(source, sourceIndex, span.start)) throw new StudioTextError('StudioText ID is outside the selected slide', 409)
    const parsed = parseStudioText(span.source)
    return { span, parsed }
  }

  async status(no: number, id: string, session?: string) {
    const ref = await this.sourceRef(no, id)
    const bytes = await readFile(ref.filePath)
    const source = textContent(bytes)
    const { span, parsed } = this.inspect(source, ref.sourceIndex, id)
    const revision = sha(bytes)
    const handle: SourceHandle = { fileId: ref.filePath, filePath: ref.filePath, textId: id,
      sourceStart: span.start, sourceEnd: span.end, expectedRevision: revision }
    const history = session ? this.history.get(session) : undefined
    return { handle, editable: parsed.ok, reason: parsed.ok ? null : parsed.reason,
      document: parsed.ok ? parsed.document : null,
      ...historyFlags(history, ref.filePath, id) }
  }

  private async replace(ref: Awaited<ReturnType<StudioTextService['sourceRef']>>, expectedRevision: string,
    id: string, replacement: string, before: Buffer, beforeSource: string, span: ReturnType<typeof uniqueStudioText>) {
    const [start, end] = byteRange(beforeSource, span.start, span.end)
    const candidate = Buffer.concat([before.subarray(0, start), Buffer.from(replacement, 'utf8'), before.subarray(end)])
    const next = textContent(candidate)
    // Fast synchronous validation: one unique ID, one supported subtree, and
    // no changed bytes outside the verified span. Full Slidev build is a test gate.
    const nextSpan = uniqueStudioText(next, id)
    const parsed = parseStudioText(nextSpan.source)
    if (!parsed.ok || nextSpan.source !== replacement || !slideContains(next, ref.sourceIndex, nextSpan.start))
      throw new StudioTextError(`Candidate StudioText invalid: ${parsed.ok ? 'span changed' : parsed.reason}`)
    if (candidate.equals(before)) return { noOp: true, revision: expectedRevision }
    const temp = join(dirname(ref.filePath), `.studio-text-${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof open>> | null = null
    try {
      handle = await open(temp, 'wx')
      await handle.writeFile(candidate)
      await handle.sync()
      await handle.close()
      handle = null
      // Studio requests for this file are serialized through withFile. An
      // external writer does not honor that mutex; this final reread detects
      // changes before rename, though an OS-level race remains after reread.
      const latest = await readFile(ref.filePath)
      if (sha(latest) !== expectedRevision) throw new StudioTextError('stale-source-revision', 409)
      await rename(temp, ref.filePath)
    }
    finally {
      if (handle) await handle.close()
      await rm(temp, { force: true })
    }
    return { noOp: false, revision: sha(candidate) }
  }

  async command(payload: {
    action: 'format' | 'typography' | 'undo' | 'redo'
    no: number
    id: string
    session: string
    expectedRevision: string
    selection?: StudioSelection
    property?: 'color' | 'fontSize'
    value?: string | number
    edit?: TypographyEdit
  }) {
    if (typeof payload.session !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(payload.session)) throw new StudioTextError('Invalid editor session')
    if (typeof payload.expectedRevision !== 'string' || !/^[0-9a-f]{64}$/.test(payload.expectedRevision)) throw new StudioTextError('Missing source revision')
    const ref = await this.sourceRef(payload.no, payload.id)
    return this.withFile(ref.filePath, async () => {
      const before = await readFile(ref.filePath)
      const revision = sha(before)
      if (revision !== payload.expectedRevision) throw new StudioTextError('stale-source-revision', 409)
      const beforeSource = textContent(before)
      const { span, parsed } = this.inspect(beforeSource, ref.sourceIndex, payload.id)
      if (!parsed.ok) throw new StudioTextError(`Visual text editing unavailable: ${parsed.reason}`, 422)
      const history = this.history.get(payload.session) ?? { undo: [], redo: [] }
      this.history.set(payload.session, history)
      if (payload.action === 'format' || payload.action === 'typography') {
        if (!payload.selection) throw new StudioTextError('Select this StudioText before formatting')
        if (payload.action === 'format' && (payload.selection.mode !== 'textRange' || !['color', 'fontSize'].includes(String(payload.property))))
          throw new StudioTextError('Select a StudioText range and supported property before formatting')
        const edit: TypographyEdit = payload.action === 'format'
          ? { domain: 'character', property: payload.property!, value: payload.value! }
          : payload.edit!
        if (!edit || typeof edit !== 'object') throw new StudioTextError('Missing typography edit')
        let outcomeModel
        try { outcomeModel = applyTypography(parsed.document, payload.selection, edit) }
        catch (error) { throw new StudioTextError((error as Error).message, 422) }
        if (outcomeModel.noOp) return { ok: true, noOp: true, revision,
          ...historyFlags(history, ref.filePath, payload.id), selection: outcomeModel.selection, document: parsed.document }
        if (outcomeModel.document === parsed.document) {
          history.undo.push({ label: `Set typing ${edit.property}`, filePath: ref.filePath, textId: payload.id,
            beforeRevision: revision, afterRevision: revision, beforeSource: span.source, afterSource: span.source,
            beforeSelection: payload.selection, afterSelection: outcomeModel.selection, selectionOnly: true })
          history.redo = []
          return { ok: true, noOp: false, revision, ...historyFlags(history, ref.filePath, payload.id),
            selection: outcomeModel.selection, document: parsed.document }
        }
        const replacement = serializeStudioText(outcomeModel.document)
        const outcome = await this.replace(ref, revision, payload.id, replacement, before, beforeSource, span)
        if (!outcome.noOp) {
          history.undo.push({ label: `Set text ${edit.property}`, filePath: ref.filePath, textId: payload.id,
            beforeRevision: revision, afterRevision: outcome.revision, beforeSource: span.source, afterSource: replacement,
            beforeSelection: payload.selection, afterSelection: outcomeModel.selection })
          history.redo = []
        }
        return { ok: true, ...outcome, ...historyFlags(history, ref.filePath, payload.id),
          selection: outcomeModel.selection, document: outcomeModel.document }
      }
      if (payload.action !== 'undo' && payload.action !== 'redo') throw new StudioTextError('Unknown text action')
      const from = payload.action === 'undo' ? history.undo : history.redo
      const to = payload.action === 'undo' ? history.redo : history.undo
      const entry = from.at(-1)
      if (!entry || entry.filePath !== ref.filePath || entry.textId !== payload.id) throw new StudioTextError('No matching text transaction', 409)
      const guardedRevision = payload.action === 'undo' ? entry.afterRevision : entry.beforeRevision
      const guardedSource = payload.action === 'undo' ? entry.afterSource : entry.beforeSource
      const replacement = payload.action === 'undo' ? entry.beforeSource : entry.afterSource
      if (revision !== guardedRevision || span.source !== guardedSource) throw new StudioTextError('stale-text-history', 409)
      if (entry.selectionOnly) {
        from.pop()
        to.push(entry)
        return { ok: true, noOp: false, revision, ...historyFlags(history, ref.filePath, payload.id),
          selection: payload.action === 'undo' ? entry.beforeSelection : entry.afterSelection, document: parsed.document }
      }
      const outcome = await this.replace(ref, revision, payload.id, replacement, before, beforeSource, span)
      if (!outcome.noOp) {
        from.pop()
        if (payload.action === 'undo') entry.beforeRevision = outcome.revision
        else entry.afterRevision = outcome.revision
        to.push(entry)
      }
      return { ok: true, ...outcome, ...historyFlags(history, ref.filePath, payload.id),
        selection: payload.action === 'undo' ? entry.beforeSelection : entry.afterSelection,
        document: parseStudioText(replacement).ok ? (parseStudioText(replacement) as { ok: true, document: typeof parsed.document }).document : parsed.document }
    })
  }
}
