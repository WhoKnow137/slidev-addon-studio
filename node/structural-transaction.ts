import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

export const ABSENT = 'absent'
export const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
export class StructuralError extends Error {
  constructor(message: string, public status = 409) { super(message) }
}
export interface Change {
  /** Project-relative path. Every path in a plan is locked and revision checked. */
  path: string
  expected: string | typeof ABSENT
  next: Buffer | null
  immutable?: boolean
}
export interface CommittedChange extends Change { before: Buffer | null, after: Buffer | null }
export interface RevisionGuard { path: string, expected: string | typeof ABSENT }
export interface TransactionPlan { label: string, changes: Change[], guards?: RevisionGuard[] }
interface JournalEntry { path: string, before: string, after: string, immutable: boolean }
interface Journal { version: 1, id: string, state: 'prepared' | 'committing' | 'complete' | 'unresolved', entries: JournalEntry[] }
const journalName = '.studio-structural'
const missing = (v: Buffer | null) => v ? digest(v) : ABSENT

async function maybeRead(path: string): Promise<Buffer | null> {
  try { return await readFile(path) }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
}
async function durableWrite(path: string, bytes: Buffer) {
  await mkdir(dirname(path), { recursive: true })
  const h = await open(path, 'wx')
  try { await h.writeFile(bytes); await h.sync() }
  finally { await h.close() }
}
async function replace(path: string, bytes: Buffer | null) {
  if (bytes === null) { await rm(path, { force: true }); return }
  await mkdir(dirname(path), { recursive: true })
  const tmp = join(dirname(path), `.studio-structural-${randomUUID()}.tmp`)
  try { await durableWrite(tmp, bytes); await rename(tmp, path) }
  finally { await rm(tmp, { force: true }) }
}
async function writeJournal(path: string, value: Journal) {
  const tmp = `${path}.${randomUUID()}.tmp`
  try { await durableWrite(tmp, Buffer.from(JSON.stringify(value))); await rename(tmp, path) }
  finally { await rm(tmp, { force: true }) }
}

/** One project-wide OS lock covers the full sorted affected set, including new files.
 * The journal records the sorted set. A dead process leaves the lock; recovery
 * checks its PID and refuses to steal a live owner's lock. */
export class StructuralTransactionStore {
  readonly root: string
  private readonly state: string
  constructor(root: string) { this.root = resolve(root); this.state = join(this.root, journalName) }
  private target(rel: string) {
    if (!rel || isAbsolute(rel) || rel.includes('\\') || rel.split('/').some(p => !p || p === '.' || p === '..'))
      throw new StructuralError('Unsafe transaction path', 422)
    const p = resolve(this.root, rel)
    if (!p.startsWith(this.root + sep) || p.startsWith(this.state + sep) || p === this.state)
      throw new StructuralError('Transaction path outside project', 422)
    return p
  }
  private async assertNoSymlinks(rel:string) {
    let current=this.root
    for(const part of rel.split('/')) {
      current=join(current,part)
      const info=await lstat(current).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e})
      if(info?.isSymbolicLink())throw new StructuralError(`Symlink transaction target refused: ${rel}`,422)
    }
  }
  relative(path: string) {
    const r = relative(this.root, resolve(path)).split(sep).join('/')
    this.target(r)
    return r
  }
  async snapshot(rel: string) {
    const bytes = await maybeRead(this.target(rel))
    return { bytes, revision: missing(bytes) }
  }
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(this.state, { recursive: true })
    const lock = join(this.state, 'lock')
    let h: Awaited<ReturnType<typeof open>>
    try { h = await open(lock, 'wx') }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      let owner = 0
      try { owner = Number((await readFile(lock, 'utf8')).split(':')[0]) } catch { /* incomplete lock */ }
      if (!owner && Date.now() - (await stat(lock)).mtimeMs < 30_000)
        throw new StructuralError('Structural transaction lock is initializing')
      if (owner > 0) { try { process.kill(owner, 0); throw new StructuralError('Structural transaction already active') }
        catch (err) { if (!(err instanceof StructuralError) && (err as NodeJS.ErrnoException).code !== 'ESRCH') throw err; if (err instanceof StructuralError) throw err } }
      await rm(lock, { force: true })
      h = await open(lock, 'wx')
    }
    try { await h.writeFile(`${process.pid}:${randomUUID()}`); await h.sync(); return await fn() }
    finally { await h.close(); await rm(lock, { force: true }) }
  }
  private async recoverLocked(): Promise<string[]> {
    const base = join(this.state, 'transactions'), resolved: string[] = []
    let ids: string[]
    try { ids = await readdir(base) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
    for (const id of ids.sort()) {
      const dir = join(base, id), manifest = join(dir, 'manifest.json')
      if (!(await stat(dir).catch(() => null))?.isDirectory()) continue
      const bytes = await maybeRead(manifest)
      if (!bytes) { await rm(dir, { recursive: true, force: true }); resolved.push(`${id}:discarded-staging`); continue }
      const journal = JSON.parse(bytes.toString()) as Journal
      if (journal.version !== 1 || journal.id !== id || journal.state === 'unresolved')
        throw new StructuralError(`Unresolved structural transaction ${id}`)
      if (journal.state === 'prepared' || journal.state === 'complete') {
        await rm(dir, { recursive: true, force: true }); resolved.push(`${id}:${journal.state}`); continue
      }
      // A committing operation is always rolled forward. Validate the entire
      // set before the first recovery write; unexpected external edits block it.
      for (const e of journal.entries) {
        await this.assertNoSymlinks(e.path)
        const now = missing(await maybeRead(this.target(e.path)))
        if (now !== e.before && now !== e.after) {
          journal.state = 'unresolved'; await writeJournal(manifest, journal)
          throw new StructuralError(`Unresolved structural transaction ${id}: ${e.path}`)
        }
      }
      const afters:(Buffer|null)[]=[]
      for (let i=0;i<journal.entries.length;i++) {
        const e=journal.entries[i],after=e.after===ABSENT?null:await maybeRead(join(dir,`${i}.after`))
        if(missing(after)!==e.after){journal.state='unresolved';await writeJournal(manifest,journal)
          throw new StructuralError(`Corrupt structural transaction ${id}`)}
        afters.push(after)
      }
      for (let i=0;i<journal.entries.length;i++) {
        const e=journal.entries[i]
        if (missing(await maybeRead(this.target(e.path))) !== e.after) await replace(this.target(e.path), afters[i])
      }
      journal.state = 'complete'; await writeJournal(manifest, journal)
      await rm(dir, { recursive: true, force: true }); resolved.push(`${id}:rolled-forward`)
    }
    return resolved
  }
  async recover() { return this.locked(() => this.recoverLocked()) }
  async withLock<T>(task:()=>Promise<T>):Promise<T> { return this.locked(async()=>{await this.recoverLocked();return task()}) }
  async commit(plan: TransactionPlan, fault?: (phase: 'staged' | 'committing' | 'write', index?: number) => void): Promise<CommittedChange[]> {
    if (!plan.label || !plan.changes.length) throw new StructuralError('Empty structural plan', 422)
    const ordered = [...plan.changes].sort((a,b) => a.path.localeCompare(b.path))
    const guards = [...(plan.guards ?? [])].sort((a,b) => a.path.localeCompare(b.path))
    if (new Set([...ordered,...guards].map(c => c.path)).size !== ordered.length+guards.length)
      throw new StructuralError('Duplicate transaction target', 422)
    for (const c of ordered) {
      this.target(c.path)
      if (c.expected !== ABSENT && !/^[0-9a-f]{64}$/.test(c.expected)) throw new StructuralError('Invalid expected revision', 422)
      if (c.immutable && (c.expected !== ABSENT || c.next === null)) throw new StructuralError('Immutable bytes cannot be changed', 422)
    }
    for (const g of guards) { this.target(g.path); if (g.expected !== ABSENT && !/^[0-9a-f]{64}$/.test(g.expected)) throw new StructuralError('Invalid guard revision', 422) }
    return this.locked(async () => {
      await this.recoverLocked()
      for(const x of [...ordered,...guards])await this.assertNoSymlinks(x.path)
      const before: (Buffer | null)[] = []
      for (const c of ordered) {
        const b = await maybeRead(this.target(c.path))
        if (missing(b) !== c.expected) throw new StructuralError(`stale-structural-revision:${c.path}`)
        before.push(b)
      }
      for (const g of guards)
        if (missing(await maybeRead(this.target(g.path))) !== g.expected)
          throw new StructuralError(`stale-structural-revision:${g.path}`)
      const id = randomUUID(), dir = join(this.state, 'transactions', id), manifest = join(dir, 'manifest.json')
      await mkdir(dir, { recursive: true })
      const journal: Journal = { version: 1, id, state: 'prepared', entries: ordered.map((c,i) => ({
        path: c.path, before: missing(before[i]), after: missing(c.next), immutable: !!c.immutable,
      })) }
      let committed = false
      try {
        for (let i=0;i<ordered.length;i++) {
          if (before[i]) await durableWrite(join(dir, `${i}.before`), before[i]!)
          if (ordered[i].next) await durableWrite(join(dir, `${i}.after`), ordered[i].next!)
        }
        await writeJournal(manifest, journal)
        fault?.('staged')
        // Reread every revision after staging, while holding the full-set lock.
        for (let i=0;i<ordered.length;i++)
          if (missing(await maybeRead(this.target(ordered[i].path))) !== ordered[i].expected)
            throw new StructuralError(`stale-structural-revision:${ordered[i].path}`)
        for (const g of guards)
          if (missing(await maybeRead(this.target(g.path))) !== g.expected)
            throw new StructuralError(`stale-structural-revision:${g.path}`)
        journal.state = 'committing'; await writeJournal(manifest, journal)
        committed = true
        fault?.('committing')
        for (let i=0;i<ordered.length;i++) {
          const c = ordered[i]
          await replace(this.target(c.path), c.next)
          fault?.('write', i)
        }
        journal.state = 'complete'; await writeJournal(manifest, journal)
        await rm(dir, { recursive: true, force: true })
        return ordered.map((c,i) => ({ ...c, before: before[i], after: c.next }))
      }
      catch (error) {
        // Prepared work is unreachable and may be discarded. Once marked
        // committing, retain the journal for deterministic restart recovery.
        if (!committed) await rm(dir, { recursive: true, force: true })
        throw error
      }
    })
  }
}
export function reverseChanges(changes: CommittedChange[], direction: 'undo' | 'redo'): Change[] {
  return changes.map(c => ({ path: c.path, expected: missing(direction === 'undo' ? c.after : c.before),
    next: direction === 'undo' ? c.before : c.after }))
}

/** M6 infrastructure for a later media editor. The caller supplies the full
 * source and reachability candidate in the same plan; this helper refuses a
 * staged blob that no candidate actually references. It never rewrites bytes. */
export async function stageImmutableResource(store: StructuralTransactionStore, plan: TransactionPlan,
  bytes: Buffer, extension: string): Promise<{ plan: TransactionPlan, path: string, url: string, sha256: string }> {
  if (!['png','jpg','jpeg','gif','webp','avif','mp4','mov','webm'].includes(extension) || !bytes.length)
    throw new StructuralError('Unsupported resource type or empty bytes',422)
  const ascii=(start:number,end:number)=>bytes.subarray(start,end).toString('ascii')
  const ftyp=bytes.length>=12&&ascii(4,8)==='ftyp',brand=ascii(8,12)
  const signature=extension==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    :['jpg','jpeg'].includes(extension)?bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255
    :extension==='gif'?['GIF87a','GIF89a'].includes(ascii(0,6))
    :extension==='webp'?ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP'
    :extension==='avif'?ftyp&&['avif','avis'].includes(brand)
    :extension==='webm'?bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))
    :ftyp&&!['avif','avis'].includes(brand)
  if(!signature)throw new StructuralError('Resource bytes do not match media signature',422)
  const sha256=digest(bytes),path=`public/media/local-${sha256}.${extension}`,url=`/media/local-${sha256}.${extension}`
  const page=plan.changes.some(c=>c.path.endsWith('.md')&&c.next?.includes(Buffer.from(url)))
  const reach=plan.changes.find(c=>c.path==='data/resource-reachability.json')?.next
  let linked=false
  try { const manifest=JSON.parse(reach?.toString()??'null');linked=Array.isArray(manifest?.refs?.[url])&&manifest.refs[url].length>0 }
  catch { /* invalid manifest below */ }
  if(!page||!linked)throw new StructuralError('Resource must be referenced by source and reachability candidate',422)
  const prior=await store.snapshot(path)
  if(prior.bytes&&!prior.bytes.equals(bytes))throw new StructuralError('Immutable resource hash collision',409)
  if(prior.bytes)return {plan,path,url,sha256}
  if(plan.changes.some(c=>c.path===path))throw new StructuralError('Duplicate staged resource',422)
  return {plan:{...plan,changes:[...plan.changes,{path,expected:ABSENT,next:bytes,immutable:true}]},path,url,sha256}
}
