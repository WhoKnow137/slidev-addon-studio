import { beforeEach, afterEach, it, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedSlidevOptions } from '@slidev/types'
import { planStructural } from '../node/structural-service'
import { StudioTextService } from '../node/studio-text-service'
import { StructuralTransactionStore, digest, reverseChanges } from '../node/structural-transaction'
import { parseManagedLayer } from '../shared/managed-layer'

let root:string,options:ResolvedSlidevOptions,store:StructuralTransactionStore,service:StudioTextService
const layer=(id:string,slide:string,kind='image',x=100,y=100,inner='<DeckImage src="/media/shared.png" />')=>
  `<StudioLayer version="1" id="${id}" slide-id="${slide}" source-id="synthetic:${id}" source-type="RECTANGLE" kind="${kind}" pos="${x},${y},100,80" rotate="0" rotation="true" capability="POSITION_ONLY" reason="synthetic">${inner}</StudioLayer>`
const text=`<StudioText version="1" id="text-a" pos="20,20,400,60" resize="fixed" rotate="0" font-size="30" font-family="Inter" color="#ffffff">Hello</StudioText>`
const page=(id:string,body:string,note:string)=>`---\nlayout: figma\nfigmaSlideId: '${id}'\nfigmaNavTarget: null\n---\n\n${body}\n\n<!-- ${note} -->\n`
const slides=(paths:string[])=>`---\ntitle: Synthetic\nsrc: ./${paths[0]}\n---\n\n${paths.slice(1).map(x=>`---\nsrc: ./${x}\n---`).join('\n\n')}\n`
const index=()=>[
  {id:'slide-a',page:'pages/001.md',data:'data/slides/001',skipped:false,order:1,label:'A',notesStatus:'present'},
  {id:'slide-b',page:'pages/002.md',data:'data/slides/002',skipped:false,order:2,label:'B',notesStatus:'present'},
]
const b=(x:string)=>Buffer.from(x)
const file=async (p:string)=>readFile(join(root,p),'utf8')
const commit=async (action:Parameters<typeof planStructural>[1])=>{const p=await planStructural(options,action);await p.store.commit(p.plan);return p}
beforeEach(async()=>{
  root=await mkdtemp(join(tmpdir(),'m6-structure-'));store=new StructuralTransactionStore(root)
  await mkdir(join(root,'pages'),{recursive:true});await mkdir(join(root,'data/slides/001'),{recursive:true});await mkdir(join(root,'data/slides/002'),{recursive:true})
  const frame=layer('frame-a','slide-a','frame',300,200,'<DeckGroup style="position:relative;width:100%;height:100%"></DeckGroup>')
  await writeFile(join(root,'pages/001.md'),page('slide-a',[layer('image-a','slide-a'),frame,text].join('\n\n'),'notes A'))
  await writeFile(join(root,'pages/002.md'),page('slide-b',layer('image-b','slide-b','image',50,40),'notes B'))
  await writeFile(join(root,'slides.md'),slides(['pages/001.md','pages/002.md']))
  await writeFile(join(root,'data/slides/index.json'),JSON.stringify(index()))
  for(const [no,id,note] of [['001','slide-a','notes A'],['002','slide-b','notes B']]){
    await writeFile(join(root,`data/slides/${no}/notes.json`),JSON.stringify({status:'present',blocks:[{text:note}]}))
    await writeFile(join(root,`data/slides/${no}/scene.json`),JSON.stringify({id,children:[]}))
    await writeFile(join(root,`data/slides/${no}/media.json`),JSON.stringify({slideId:id,placements:[]}))
  }
  options={data:{entry:{filepath:join(root,'slides.md')},slides:[{source:{filepath:join(root,'pages/001.md'),index:0}},{source:{filepath:join(root,'pages/002.md'),index:0}}]}} as unknown as ResolvedSlidevOptions
  service=new StudioTextService(options)
})
afterEach(async()=>{await rm(root,{recursive:true,force:true})})

it('deletes a managed tree, persists a tombstone, and does not delete shared media bytes',async()=>{
  const prior=await file('pages/001.md')
  await commit({kind:'object',action:'delete',slideId:'slide-a',id:'image-a'})
  expect(await file('pages/001.md')).not.toContain('id="image-a"')
  expect(JSON.parse(await file('data/structural-provenance.json')).objects['image-a'].state).toBe('deleted')
  expect(await file('pages/001.md')).toContain('notes A')
  expect((await file('data/resource-reachability.json'))).toContain('/media/shared.png')
  expect(prior).toContain('id="image-a"')
})
it('duplicates with fresh IDs and reorders without changing geometry',async()=>{
  await commit({kind:'object',action:'duplicate',slideId:'slide-a',id:'image-a'})
  const first=await file('pages/001.md'),ids=[...first.matchAll(/id="(local-m6-\d+)"/g)].map(m=>m[1])
  expect(ids).toHaveLength(1);expect(first.match(/\/media\/shared\.png/g)?.length).toBe(2)
  await commit({kind:'object',action:'reorder',slideId:'slide-a',id:ids[0],beforeId:'image-a'})
  const next=await file('pages/001.md')
  expect(next.indexOf(`id="${ids[0]}"`)).toBeLessThan(next.indexOf('id="image-a"'))
  expect(next).toContain('pos="100,100,100,80"')
})
it('reparents an unrotated child under a supported frame with world placement preserved',async()=>{
  await commit({kind:'object',action:'reparent',slideId:'slide-a',id:'image-a',parentId:'frame-a'})
  const next=await file('pages/001.md')
  expect(next).toContain('parent-id="frame-a"')
  expect(next).toContain('pos="-200,-100,100,80"')
  expect(next.indexOf('id="image-a"')).toBeGreaterThan(next.indexOf('<DeckGroup'))
})
it('preserves child world transform when reparenting under a rotated frame',async()=>{
  const original=(await file('pages/001.md')).replace('id="frame-a" slide-id="slide-a" source-id="synthetic:frame-a" source-type="RECTANGLE" kind="frame" pos="300,200,100,80" rotate="0"',
    'id="frame-a" slide-id="slide-a" source-id="synthetic:frame-a" source-type="RECTANGLE" kind="frame" pos="300,200,100,80" rotate="90"')
  await writeFile(join(root,'pages/001.md'),original)
  await commit({kind:'object',action:'reparent',slideId:'slide-a',id:'image-a',parentId:'frame-a'})
  const result=await file('pages/001.md'),nested=result.match(/<StudioLayer[^>]*parent-id="frame-a"[^>]*>[^]*?<\/StudioLayer>/)?.[0]
  expect(nested).toBeTruthy()
  const child=parseManagedLayer(nested!),parent=parseManagedLayer(original.match(/<StudioLayer[^>]*id="frame-a"[^]*?<\/StudioLayer>/)![0])
  const mat=(g:typeof child.geometry)=>{const a=g.rotationDeg*Math.PI/180,c=Math.cos(a),s=Math.sin(a),hx=g.width/2,hy=g.height/2
    return {a:c,b:s,c:-s,d:c,e:g.x+hx-c*hx+s*hy,f:g.y+hy-s*hx-c*hy}}
  const p=mat(parent.geometry),q=mat(child.geometry),e=p.a*q.e+p.c*q.f+p.e,f=p.b*q.e+p.d*q.f+p.f
  expect(e).toBeCloseTo(100,4);expect(f).toBeCloseTo(100,4)
})
it('moves a root across pages and preserves notes association',async()=>{
  await commit({kind:'object',action:'move',slideId:'slide-a',id:'image-a',toSlideId:'slide-b'})
  expect(await file('pages/001.md')).not.toContain('id="image-a"')
  expect(await file('pages/002.md')).toContain('id="image-a" slide-id="slide-b"')
  expect(await file('pages/001.md')).toContain('notes A');expect(await file('pages/002.md')).toContain('notes B')
  expect(JSON.parse(await file('data/structural-provenance.json')).objects['image-a'].state).toBe('moved')
})
it('moves editable text across slides without changing its content or notes',async()=>{
  await commit({kind:'object',action:'move',slideId:'slide-a',id:'text-a',toSlideId:'slide-b'})
  expect(await file('pages/001.md')).not.toContain('id="text-a"')
  expect(await file('pages/002.md')).toContain('id="text-a"')
  expect(await file('pages/002.md')).toContain('>Hello</StudioText>')
  expect(await file('pages/001.md')).toContain('notes A');expect(await file('pages/002.md')).toContain('notes B')
})
it('duplicates a StudioText root as editable text with a fresh identity',async()=>{
  await commit({kind:'object',action:'duplicate',slideId:'slide-a',id:'text-a'})
  const source=await file('pages/001.md')
  expect((source.match(/>Hello<\/StudioText>/g)??[])).toHaveLength(2)
  expect(source).toMatch(/<StudioText[^>]*id="local-m6-\d+"/)
  expect(source).toContain('<!-- notes A -->')
})
it('reorders, duplicates, and deletes slides with page, index, and notes in one state',async()=>{
  await commit({kind:'slide',action:'reorder',slideId:'slide-b',beforeSlideId:'slide-a'})
  expect((await file('slides.md')).indexOf('002.md')).toBeLessThan((await file('slides.md')).indexOf('001.md'))
  const p=await commit({kind:'slide',action:'duplicate',slideId:'slide-a'})
  const rows=JSON.parse(await file('data/slides/index.json')),copy=rows.find((x:{localDuplicateOf?:string})=>x.localDuplicateOf==='slide-a')
  expect(copy).toBeTruthy();expect(await file(`${copy.data}/notes.json`)).toBe(await file('data/slides/001/notes.json'))
  expect(await file(copy.page)).toContain(`figmaSlideId: '${copy.id}'`)
  expect(await file(copy.page)).not.toContain('id="image-a"')
  expect(p.total).toBe(3)
  await commit({kind:'slide',action:'delete',slideId:'slide-b'})
  expect(JSON.parse(await file('data/slides/index.json')).some((x:{id:string})=>x.id==='slide-b')).toBe(false)
  expect((await store.snapshot('pages/002.md')).revision).toBe('absent')
  expect((await store.snapshot('data/slides/002/notes.json')).revision).toBe('absent')
})
it('retargets numeric navigation by logical slide identity when order changes',async()=>{
  const first=(await file('pages/001.md')).replace('figmaNavTarget: null','figmaNavTarget: 2')
  await writeFile(join(root,'pages/001.md'),first)
  await commit({kind:'slide',action:'reorder',slideId:'slide-b',beforeSlideId:'slide-a'})
  expect(await file('pages/001.md')).toContain('figmaNavTarget: 1')
  const index=JSON.parse(await file('data/slides/index.json'))
  expect(index.filter((r:{skipped:boolean})=>!r.skipped).map((r:{id:string})=>r.id)).toEqual(['slide-b','slide-a'])
  expect(await file('data/slides/001/notes.json')).toContain('notes A')
})
it('records one structural history entry, undo and redo restore every changed file',async()=>{
  const original=await file('pages/001.md'),rev=digest(b(original))
  const changed=await service.structuralCommand({action:{kind:'object',action:'delete',slideId:'slide-a',id:'image-a'},session:'m6-session',expectedRevision:rev})
  expect((await service.historyStatus('m6-session')).undo).toBe('object delete')
  const undone=await service.historyCommand({action:'undo',no:1,session:'m6-session',expectedRevision:changed.revision})
  expect(await file('pages/001.md')).toBe(original)
  expect((await store.snapshot('data/structural-provenance.json')).revision).toBe('absent')
  await service.historyCommand({action:'redo',no:1,session:'m6-session',expectedRevision:undone.revision})
  expect(await file('pages/001.md')).not.toContain('id="image-a"')
})
it('keeps layer, text, and structural edits in one undo/redo order',async()=>{
  const original=await file('pages/001.md'),session='m6-chronology'
  const layerEdit=await service.layerCommand({action:'geometry',no:1,id:'image-a',session,expectedRevision:digest(b(original)),geometryEdit:{kind:'translate',dx:5,dy:0}})
  const moved=await file('pages/001.md')
  const textEdit=await service.command({action:'typography',no:1,id:'text-a',session,expectedRevision:layerEdit.revision,
    selection:{mode:'objects',ids:['text-a']},edit:{domain:'character',property:'fontSize',value:32}})
  const formatted=await file('pages/001.md')
  await service.structuralCommand({action:{kind:'object',action:'duplicate',slideId:'slide-a',id:'image-a'},session,expectedRevision:textEdit.revision})
  let h=await service.historyStatus(session);expect(h.undo).toBe('object duplicate')
  await service.historyCommand({action:'undo',no:1,session,expectedRevision:h.undoHead!.revision})
  expect(await file('pages/001.md')).toBe(formatted)
  h=await service.historyStatus(session);await service.historyCommand({action:'undo',no:1,session,expectedRevision:h.undoHead!.revision})
  expect(await file('pages/001.md')).toBe(moved)
  h=await service.historyStatus(session);await service.historyCommand({action:'undo',no:1,session,expectedRevision:h.undoHead!.revision})
  expect(await file('pages/001.md')).toBe(original)
  for(let i=0;i<3;i++){h=await service.historyStatus(session);await service.historyCommand({action:'redo',no:1,session,expectedRevision:h.redoHead!.revision})}
  expect(await file('pages/001.md')).not.toBe(formatted)
})
it('refuses an entire cross-page move when one destination revision goes stale',async()=>{
  const before=await file('pages/001.md'),planned=await planStructural(options,{kind:'object',action:'move',slideId:'slide-a',id:'image-a',toSlideId:'slide-b'})
  await writeFile(join(root,'pages/002.md'),(await file('pages/002.md'))+'\nexternal')
  await expect(planned.store.commit(planned.plan)).rejects.toThrow('stale-structural-revision:pages/002.md')
  expect(await file('pages/001.md')).toBe(before)
  expect((await store.snapshot('data/structural-provenance.json')).revision).toBe('absent')
})
it('replanning from an exactly undone state yields the same IDs and candidate bytes',async()=>{
  const first=await planStructural(options,{kind:'object',action:'duplicate',slideId:'slide-a',id:'image-a'})
  const before=first.plan.changes.map(c=>[c.path,c.next?.toString()])
  const committed=await first.store.commit(first.plan)
  await first.store.commit({label:'undo',changes:reverseChanges(committed,'undo')})
  const again=await planStructural(options,{kind:'object',action:'duplicate',slideId:'slide-a',id:'image-a'})
  expect(again.plan.changes.map(c=>[c.path,c.next?.toString()])).toEqual(before)
  const original=await file('pages/002.md')
  await again.store.commit(again.plan)
  expect(await file('pages/002.md')).toBe(original)
})
