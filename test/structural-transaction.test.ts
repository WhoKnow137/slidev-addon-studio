import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ABSENT, StructuralTransactionStore, digest, reverseChanges, stageImmutableResource } from '../node/structural-transaction'

let root: string, store: StructuralTransactionStore
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'studio-m6-')); store = new StructuralTransactionStore(root) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const b = (s: string) => Buffer.from(s)
const content = async (name: string) => readFile(join(root, name), 'utf8')

describe('journaled structural transaction', () => {
  it('commits multiple files as one plan and reverses complete state', async () => {
    await writeFile(join(root,'a.md'),'A'); await writeFile(join(root,'b.md'),'B')
    const changes = await store.commit({ label:'two', changes:[
      { path:'b.md', expected:digest(b('B')), next:b('B2') },
      { path:'a.md', expected:digest(b('A')), next:b('A2') },
      { path:'new.bin', expected:ABSENT, next:b('resource'), immutable:true },
    ] })
    expect(changes.map(c=>c.path)).toEqual(['a.md','b.md','new.bin'])
    expect(await content('a.md')).toBe('A2'); expect(await content('b.md')).toBe('B2')
    await store.commit({ label:'undo', changes:reverseChanges(changes,'undo') })
    expect(await content('a.md')).toBe('A'); expect(await content('b.md')).toBe('B')
    expect((await store.snapshot('new.bin')).revision).toBe(ABSENT)
    await store.commit({ label:'redo', changes:reverseChanges(changes,'redo') })
    expect(await content('new.bin')).toBe('resource')
  })
  it('rejects one stale member before any write', async () => {
    await writeFile(join(root,'a'),'A'); await writeFile(join(root,'b'),'changed')
    await expect(store.commit({label:'stale',changes:[
      {path:'a',expected:digest(b('A')),next:b('new A')},
      {path:'b',expected:digest(b('B')),next:b('new B')},
    ]})).rejects.toThrow('stale-structural-revision:b')
    expect(await content('a')).toBe('A'); expect(await content('b')).toBe('changed')
  })
  it('discards failed staging and leaves all targets untouched', async () => {
    await writeFile(join(root,'a'),'A')
    await expect(store.commit({label:'fault',changes:[{path:'a',expected:digest(b('A')),next:b('B')} ]},
      phase => { if (phase==='staged') throw Error('synthetic stage failure') })).rejects.toThrow('synthetic stage failure')
    expect(await content('a')).toBe('A'); expect(await store.recover()).toEqual([])
  })
  it('recovers an interrupted multi-file commit by rolling forward', async () => {
    await writeFile(join(root,'a'),'A'); await writeFile(join(root,'b'),'B')
    await expect(store.commit({label:'crash',changes:[
      {path:'a',expected:digest(b('A')),next:b('A2')}, {path:'b',expected:digest(b('B')),next:b('B2')},
    ]}, (phase,i) => { if (phase==='write' && i===0) throw Error('synthetic crash') })).rejects.toThrow('synthetic crash')
    expect(await content('a')).toBe('A2'); expect(await content('b')).toBe('B')
    expect((await new StructuralTransactionStore(root).recover())[0]).toMatch(/rolled-forward/)
    expect(await content('a')).toBe('A2'); expect(await content('b')).toBe('B2')
  })
  it('blocks recovery if a half-committed target was externally changed', async () => {
    await writeFile(join(root,'a'),'A'); await writeFile(join(root,'b'),'B')
    await expect(store.commit({label:'crash',changes:[
      {path:'a',expected:digest(b('A')),next:b('A2')}, {path:'b',expected:digest(b('B')),next:b('B2')},
    ]}, (phase,i) => { if (phase==='write' && i===0) throw Error('synthetic crash') })).rejects.toThrow()
    await writeFile(join(root,'b'),'external')
    await expect(store.recover()).rejects.toThrow('Unresolved structural transaction')
    expect(await content('b')).toBe('external')
  })
  it('reports a corrupt staged blob as unresolved before replaying another target',async()=>{
    await writeFile(join(root,'a'),'A');await writeFile(join(root,'b'),'B')
    await expect(store.commit({label:'crash',changes:[
      {path:'a',expected:digest(b('A')),next:b('A2')},{path:'b',expected:digest(b('B')),next:b('B2')},
    ]},(phase,i)=>{if(phase==='write'&&i===0)throw Error('stop')})).rejects.toThrow('stop')
    const [id]=await readdir(join(root,'.studio-structural/transactions'))
    await writeFile(join(root,'.studio-structural/transactions',id,'1.after'),'corrupt')
    await expect(store.recover()).rejects.toThrow('Corrupt structural transaction')
    expect(await content('a')).toBe('A2');expect(await content('b')).toBe('B')
  })
  it('stages immutable bytes only with a matching source and reachability update',async()=>{
    await writeFile(join(root,'slide.md'),'before')
    const media=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9QotkWQAAAAASUVORK5CYII=','base64'),sha=digest(media),url=`/media/local-${sha}.png`
    const plan={label:'attach',changes:[
      {path:'slide.md',expected:digest(b('before')),next:b(`<img src="${url}">`)},
      {path:'data/resource-reachability.json',expected:ABSENT,next:b(JSON.stringify({schemaVersion:1,refs:{[url]:['slide-a']}}))},
    ]}
    await expect(stageImmutableResource(store,plan,b('not a PNG'),'png')).rejects.toThrow('media signature')
    await expect(stageImmutableResource(store,{label:'bad',changes:[plan.changes[0]]},media,'png')).rejects.toThrow('reachability')
    const staged=await stageImmutableResource(store,plan,media,'png')
    await expect(store.commit(staged.plan,phase=>{if(phase==='staged')throw Error('abort')})).rejects.toThrow('abort')
    expect((await store.snapshot(staged.path)).revision).toBe(ABSENT)
    expect((await store.snapshot('data/resource-reachability.json')).revision).toBe(ABSENT)
    expect(await content('slide.md')).toBe('before')
    await store.commit(staged.plan)
    expect(await readFile(join(root,staged.path))).toEqual(media)
    expect(await content('slide.md')).toContain(url)
    await writeFile(join(root,'second.md'),`<img src="${url}">`)
    const first=await store.snapshot('slide.md'),reach=await store.snapshot('data/resource-reachability.json')
    await store.commit({label:'remove one reference',changes:[
      {path:'slide.md',expected:first.revision,next:b('empty')},
      {path:'data/resource-reachability.json',expected:reach.revision,next:b(JSON.stringify({schemaVersion:1,refs:{[url]:['slide-b']}}))},
    ]})
    expect(await readFile(join(root,staged.path))).toEqual(media)
  })
})
