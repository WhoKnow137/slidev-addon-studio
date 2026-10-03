import type { ResolvedSlidevOptions } from '@slidev/types'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { managedLayerSpans, parseManagedLayer } from '../shared/managed-layer'
import { studioTextSpans, parseStudioText } from '../shared/studiotext'
import { ABSENT, StructuralError, StructuralTransactionStore, digest } from './structural-transaction'
import type { Change, TransactionPlan, RevisionGuard } from './structural-transaction'

type Kind = 'StudioLayer' | 'StudioText'
interface Owned { id: string, kind: Kind, start: number, end: number, source: string }
interface IndexRow { id: string, page: string, data: string, skipped: boolean, order: number | null, [key: string]: unknown }
interface OverlayObject { origin: 'imported' | 'local-duplicate', state: 'active' | 'deleted' | 'reordered' | 'reparented' | 'moved' | 'source-removed',
  sourceSlideId: string, currentSlideId: string | null, sourceFile: string, sourceFingerprint?: string, duplicateOf?: string, parentId?: string }
interface Overlay { schemaVersion: 1, nextId: number, objects: Record<string,OverlayObject>, slides: Record<string,{ state: 'active' | 'deleted' | 'reordered', duplicateOf?: string }> }
export type StructuralAction =
  | { kind:'object', action:'delete' | 'duplicate' | 'reorder' | 'reparent' | 'move', slideId:string, id:string,
      beforeId?:string, parentId?:string, toSlideId?:string }
  | { kind:'slide', action:'duplicate' | 'delete' | 'reorder', slideId:string, beforeSlideId?:string }
interface Project { store:StructuralTransactionStore, index:IndexRow[], slides:string, overlay:Overlay,
  versions:Map<string,{bytes:Buffer|null,revision:string}>, candidates:Map<string,Buffer|null>, guards:Map<string,RevisionGuard>,
  baselines:Map<string,{slideId:string,sourceFile:string,sourceFingerprint:string}> }
const json = (value:unknown) => Buffer.from(`${JSON.stringify(value,null,2)}\n`)
const asString = (p:Project,path:string) => { const bytes=p.candidates.get(path)??p.versions.get(path)?.bytes
  if(!bytes)throw new StructuralError(`Missing managed project file: ${path}`)
  const value=bytes.toString('utf8');if(!Buffer.from(value).equals(bytes))throw new StructuralError(`Invalid UTF-8: ${path}`)
  return value }
const tracked = async (p:Project,path:string) => {
  if(!p.versions.has(path))p.versions.set(path,await p.store.snapshot(path))
  return p.versions.get(path)!
}
const set = async (p:Project,path:string,next:Buffer|null) => { await tracked(p,path);p.candidates.set(path,next);p.guards.delete(path) }
const guard = async (p:Project,path:string) => { const snap=await tracked(p,path);if(!p.candidates.has(path))p.guards.set(path,{path,expected:snap.revision});return snap }
const active = (p:Project) => p.index.filter(row=>!row.skipped).sort((a,b)=>(a.order??0)-(b.order??0))
const row = (p:Project,id:string) => {
  const matches=p.index.filter(r=>r.id===id&&!r.skipped)
  if(matches.length!==1)throw new StructuralError('Active slide identity unavailable or ambiguous',422)
  return matches[0]
}
function owned(source:string):Owned[] {
  const all=[...managedLayerSpans(source).map(s=>({...s,kind:'StudioLayer' as const})),
    ...studioTextSpans(source).map(s=>({...s,kind:'StudioText' as const}))].sort((a,b)=>a.start-b.start)
  if(new Set(all.map(x=>x.id)).size!==all.length)throw new StructuralError('Ambiguous managed identity',422)
  for(let i=1;i<all.length;i++)if(all[i].start<all[i-1].end)throw new StructuralError('Overlapping managed roots',422)
  return all
}
function one(source:string,id:string) {
  const hits=owned(source).filter(s=>s.id===id)
  if(hits.length!==1)throw new StructuralError(`Managed root unavailable: ${id}`,422)
  const x=hits[0]
  if(x.kind==='StudioLayer') {
    const m=parseManagedLayer(x.source)
    if(m.capabilities.level==='READ_ONLY'||m.capabilities.level==='UNAVAILABLE'||m.kind==='instance')
      throw new StructuralError(m.capabilities.reason||'Structural ownership unavailable',422)
  }
  else if(!parseStudioText(x.source).ok)throw new StructuralError('Unsupported StudioText root',422)
  return x
}
const splice = (s:string,start:number,end:number,part:string) => s.slice(0,start)+part+s.slice(end)
const replaceAttribute = (tag:string,name:string,value:string) => {
  const re=new RegExp(`(\\s${name}=")[^"]*(")`)
  if(!re.test(tag))throw new StructuralError(`Missing ${name} attribute`,422)
  return tag.replace(re,(_,a,b)=>`${a}${value}${b}`)
}
function cloneTree(source:string, slideId:string, allocate:()=>string, duplicate:boolean) {
  let count=0
  const result=source.replace(/<(StudioLayer|StudioText)\b[^>]*>/g,tag=>{
    let next=replaceAttribute(tag,'id',allocate());count++
    if(tag.startsWith('<StudioLayer'))next=replaceAttribute(next,'slide-id',slideId)
    return next
  })
  if(!count&&duplicate)throw new StructuralError('No managed identity in tree',422)
  if(duplicate&&result===source)throw new StructuralError('Duplicate kept original identity',422)
  return result
}
function changeSlideId(source:string,slideId:string) {
  return source.replace(/<StudioLayer\b[^>]*>/g,tag=>replaceAttribute(tag,'slide-id',slideId))
}
function navPatch(source:string,oldIds:string[],newIds:string[]) {
  return source.replace(/^(figmaNavTarget:\s*)(\d+)(\s*)$/m,(_,a,n,b)=>{
    const target=oldIds[Number(n)-1],newNo=target?newIds.indexOf(target)+1:0
    return `${a}${newNo||'null'}${b}`
  })
}
function managedImports(source:string, paths:string[]) {
  const match=source.match(/^(---\r?\n[\s\S]*?\r?\n---)([\s\S]*)$/)
  if(!match)throw new StructuralError('Unsupported Slidev import headmatter',422)
  const old=paths.map(path=>`./${path}`), first=match[1].match(/^src: (\.\/pages\/[^\r\n]+)$/m)
  if(!first||first[1]!==old[0])throw new StructuralError('Slide import/index mismatch',422)
  const tail=match[2].trim(), expected=old.slice(1).map(x=>`---\nsrc: ${x}\n---`).join('\n\n')
  if(tail!==expected)throw new StructuralError('Hand-authored import structure requires explicit migration',422)
  return (next:string[]) => match[1].replace(/^src: \.\/pages\/[^\r\n]+$/m,`src: ./${next[0]}`)
    +'\n\n'+next.slice(1).map(x=>`---\nsrc: ./${x}\n---`).join('\n\n')+'\n'
}
function overlayRecord(p:Project,id:string,slideId:string,sourceFile:string):OverlayObject {
  const found=p.overlay.objects[id]
  if(found)return found
  const baseline=p.baselines.get(id)
  return {origin:'imported',state:'active',sourceSlideId:baseline?.slideId??slideId,currentSlideId:slideId,
    sourceFile:baseline?.sourceFile??sourceFile,...(baseline?.sourceFingerprint?{sourceFingerprint:baseline.sourceFingerprint}:{})}
}
function matrix(g:{x:number,y:number,width:number,height:number,rotationDeg:number}) {
  const r=g.rotationDeg*Math.PI/180,c=Math.cos(r),s=Math.sin(r),hx=g.width/2,hy=g.height/2
  return {a:c,b:s,c:-s,d:c,e:g.x+hx-c*hx+s*hy,f:g.y+hy-s*hx-c*hy}
}
function localGeometry(child:ReturnType<typeof parseManagedLayer>['geometry'],parent:ReturnType<typeof parseManagedLayer>['geometry']) {
  const m=matrix(child),p=matrix(parent),det=p.a*p.d-p.b*p.c
  if(Math.abs(det)<1e-9)throw new StructuralError('Non-invertible parent transform',422)
  const a=(p.d*m.a-p.c*m.b)/det,b=(-p.b*m.a+p.a*m.b)/det
  const e=(p.d*(m.e-p.e)-p.c*(m.f-p.f))/det,f=(-p.b*(m.e-p.e)+p.a*(m.f-p.f))/det
  const angle=Math.atan2(b,a),c=Math.cos(angle),s=Math.sin(angle),hx=child.width/2,hy=child.height/2
  return {x:e-hx+c*hx-s*hy,y:f-hy+s*hx+c*hy,width:child.width,height:child.height,rotationDeg:angle*180/Math.PI}
}
function patchLayerForParent(source:string,parentId:string,g:ReturnType<typeof parseManagedLayer>['geometry']) {
  const opening=source.match(/^<StudioLayer\b[^>]*>/)?.[0]
  if(!opening)throw new StructuralError('Managed layer opening missing',422)
  const numbers=[g.x,g.y,g.width,g.height].map(n=>Number(n.toFixed(6))).join(',')
  const next=replaceAttribute(replaceAttribute(opening,'pos',numbers),'rotate',String(Number(g.rotationDeg.toFixed(6))))
  return next.replace(/>$/,` parent-id="${parentId}">`)+source.slice(opening.length)
}
function refs(source:string) { return [...source.matchAll(/(?:src|href)=["'](\/media\/[A-Za-z0-9._-]+)["']/g)].map(m=>m[1]) }

async function readProject(options:ResolvedSlidevOptions):Promise<Project> {
  const root=dirname(options.data.entry.filepath),store=new StructuralTransactionStore(root),versions=new Map(),candidates=new Map(),guards=new Map()
  const p:Project={store,index:[] as IndexRow[],slides:'',overlay:{schemaVersion:1,nextId:1,objects:{},slides:{}},versions,candidates,guards,baselines:new Map()}
  const ix=await tracked(p,'data/slides/index.json'),md=await tracked(p,'slides.md'),ov=await tracked(p,'data/structural-provenance.json')
  if(!ix.bytes||!md.bytes)throw new StructuralError('Generated project metadata unavailable',422)
  p.index=JSON.parse(ix.bytes.toString());p.slides=md.bytes.toString()
  if(!Array.isArray(p.index)||!p.index.every(r=>r.id&&r.page&&r.data))throw new StructuralError('Invalid slide index',422)
  for(const key of ['id','page','data'] as const)
    if(new Set(p.index.map(r=>r[key])).size!==p.index.length)throw new StructuralError(`Ambiguous slide ${key}`,422)
  if(ov.bytes){p.overlay=JSON.parse(ov.bytes.toString());if(p.overlay.schemaVersion!==1)throw new StructuralError('Unsupported structural provenance',422)}
  for(const path of ['data/layer-provenance.json','data/conversion-provenance.json']){
    const snap=await guard(p,path);if(!snap.bytes)continue
    const manifest=JSON.parse(snap.bytes.toString())
    for(const item of manifest.objects??[])p.baselines.set(item.objectId??item.studioId,{slideId:item.slideId,sourceFile:item.sourceFile,sourceFingerprint:item.sourceFingerprint})
  }
  managedImports(p.slides,active(p).map(r=>r.page))
  return p
}
async function ensureUniqueId(p:Project,id:string) {
  for(const r of p.index){const s=await tracked(p,r.page);if(s.bytes&&owned(asString(p,r.page)).some(o=>o.id===id))return false}
  return true
}
async function allocate(p:Project) {
  while(true){const id=`local-m6-${String(p.overlay.nextId++).padStart(8,'0')}`;if(await ensureUniqueId(p,id))return id}
}
async function candidatePages(p:Project) {
  const tally:Record<string,string[]>={},identities=new Set<string>()
  for(const r of p.index) {
    if(!p.candidates.has(r.page))await guard(p,r.page)
    const source=p.candidates.get(r.page)===null?null:asString(p,r.page)
    if(!source)continue
    owned(source)
    for(const match of source.matchAll(/<(?:StudioLayer|StudioText)\b[^>]*\sid="([^"]+)"/g)){
      if(identities.has(match[1]))throw new StructuralError(`Duplicate managed identity: ${match[1]}`,422)
      identities.add(match[1])
    }
    for(const url of refs(source))(tally[url]??=[]).push(r.id)
  }
  for(const ids of Object.values(tally))ids.sort()
  await set(p,'data/resource-reachability.json',json({schemaVersion:1,refs:Object.fromEntries(Object.entries(tally).sort(([a],[b])=>a.localeCompare(b)))}))
}

export async function structuralStatus(options:ResolvedSlidevOptions) {
  const p=await readProject(options)
  const revisions:Record<string,string>={}
  for(const path of ['slides.md','data/slides/index.json','data/structural-provenance.json'])revisions[path]=(await tracked(p,path)).revision
  for(const item of active(p))revisions[item.page]=(await tracked(p,item.page)).revision
  return {supported:true,revisions,slides:active(p).map(r=>({id:r.id,page:r.page}))}
}
export async function planStructural(options:ResolvedSlidevOptions,action:StructuralAction):Promise<{store:StructuralTransactionStore,plan:TransactionPlan,anchor:string,focusNo:number,total:number}> {
  const p=await readProject(options),oldRows=active(p),oldIds=oldRows.map(r=>r.id)
  let anchor='slides.md',focusNo=1
  if(action.kind==='object') {
    const sourceRow=row(p,action.slideId),file=sourceRow.page;anchor=file
    await tracked(p,file)
    const source=asString(p,file),target=one(source,action.id)
    const prior=overlayRecord(p,target.id,sourceRow.id,file)
    if(action.action==='delete') {
      await set(p,file,Buffer.from(splice(source,target.start,target.end,'')))
      p.overlay.objects[target.id]={...prior,state:'deleted',currentSlideId:null}
    }
    else if(action.action==='duplicate') {
      const ids:string[]=[]
      // Include nested managed identities; each receives a fresh, monotonic ID.
      const tags=[...target.source.matchAll(/<(?:StudioLayer|StudioText)\b[^>]*>/g)]
      for(const _ of tags)ids.push(await allocate(p))
      let i=0,copy=cloneTree(target.source,sourceRow.id,()=>ids[i++],true)
      if(target.kind==='StudioLayer')parseManagedLayer(copy);else if(!parseStudioText(copy).ok)throw new StructuralError('Invalid cloned text',422)
      await set(p,file,Buffer.from(splice(source,target.end,target.end,`\n\n${copy}`)))
      ids.forEach(id=>{p.overlay.objects[id]={origin:'local-duplicate',state:'active',sourceSlideId:prior.sourceSlideId,currentSlideId:sourceRow.id,
        sourceFile:file,duplicateOf:target.id}})
    }
    else if(action.action==='reorder') {
      if(!action.beforeId||action.beforeId===action.id)throw new StructuralError('Reorder target required',422)
      const before=one(source,action.beforeId),removed=splice(source,target.start,target.end,'')
      const where=one(removed,before.id)
      await set(p,file,Buffer.from(splice(removed,where.start,where.start,`${target.source}\n\n`)))
      p.overlay.objects[target.id]={...prior,state:'reordered'}
    }
    else if(action.action==='move') {
      if(!action.toSlideId||action.toSlideId===action.slideId)throw new StructuralError('Different destination slide required',422)
      const dest=row(p,action.toSlideId);await tracked(p,dest.page)
      const dst=asString(p,dest.page)
      if(owned(dst).some(o=>o.id===target.id))throw new StructuralError('Destination ID collision',422)
      const moved=target.kind==='StudioLayer'?changeSlideId(target.source,dest.id):target.source
      await set(p,file,Buffer.from(splice(source,target.start,target.end,'')))
      const note=dst.match(/\n\s*<!--[^]*?-->\s*$/),at=note?note.index!:dst.length
      await set(p,dest.page,Buffer.from(splice(dst,at,at,`\n\n${moved}\n`)))
      p.overlay.objects[target.id]={...prior,state:'moved',currentSlideId:dest.id}
      anchor=file
    }
    else if(action.action==='reparent') {
      if(!action.parentId||action.parentId===target.id||target.kind!=='StudioLayer')throw new StructuralError('Supported layer and frame target required',422)
      const parent=one(source,action.parentId)
      if(parent.kind!=='StudioLayer')throw new StructuralError('Parent must be managed frame',422)
      const childModel=parseManagedLayer(target.source),parentModel=parseManagedLayer(parent.source)
      if(parentModel.kind!=='frame'||parentModel.capabilities.level==='READ_ONLY'||childModel.capabilities.level==='READ_ONLY')
        throw new StructuralError('Frame constraints or component semantics unresolved',422)
      const closures=[...parent.source.matchAll(/<\/DeckGroup>/g)]
      if(closures.length!==1||parent.source.slice(parent.source.indexOf('>')+1).includes('<StudioLayer'))throw new StructuralError('Frame child structure unsupported',422)
      const local=localGeometry(childModel.geometry,parentModel.geometry)
      const nested=patchLayerForParent(target.source,parent.id,local)
      const changedParent=splice(parent.source,closures[0].index!,closures[0].index!,`\n${nested}\n`)
      // Patch parent and child from descending offsets so unrelated bytes stay exact.
      const patches=[{start:parent.start,end:parent.end,part:changedParent},{start:target.start,end:target.end,part:''}].sort((a,b)=>b.start-a.start)
      let next=source;for(const x of patches)next=splice(next,x.start,x.end,x.part)
      await set(p,file,Buffer.from(next))
      p.overlay.objects[target.id]={...prior,state:'reparented',parentId:parent.id}
    }
    focusNo=oldIds.indexOf(sourceRow.id)+1
  }
  else if(action.kind==='slide') {
    const current=row(p,action.slideId),position=oldIds.indexOf(current.id)
    if(action.action==='delete') {
      if(oldRows.length<=1)throw new StructuralError('A deck must retain a slide',422)
      p.index=p.index.filter(r=>r!==current)
      for(const [id,baseline] of p.baselines)if(baseline.slideId===current.id)
        p.overlay.objects[id]={...overlayRecord(p,id,current.id,current.page),state:'deleted',currentSlideId:null}
      for(const [id,object] of Object.entries(p.overlay.objects))if(object.currentSlideId===current.id)
        p.overlay.objects[id]={...object,state:'deleted',currentSlideId:null}
      for(const path of [current.page,...['scene.json','notes.json','media.json'].map(n=>`${current.data}/${n}`)]) {
        if((await tracked(p,path)).bytes)await set(p,path,null)
      }
      p.overlay.slides[current.id]={state:'deleted'}
      focusNo=Math.max(1,position)
    }
    else if(action.action==='duplicate') {
      const id=await allocate(p),newPage=`pages/${id}.md`,newData=`data/slides/${id}`
      await tracked(p,current.page)
      const source=asString(p,current.page),tags=[...source.matchAll(/<(?:StudioLayer|StudioText)\b[^>]*>/g)],ids:string[]=[]
      if((source.match(/^figmaSlideId:\s*.+$/gm)??[]).length!==1)throw new StructuralError('Generated slide identity missing or ambiguous',422)
      for(const _ of tags)ids.push(await allocate(p))
      let k=0,copy=cloneTree(source,id,()=>ids[k++],false).replace(/^(figmaSlideId:\s*).+$/m,`$1'${id}'`)
      await set(p,newPage,Buffer.from(copy))
      for(const name of ['scene.json','notes.json','media.json']) {
        const oldPath=`${current.data}/${name}`,newPath=`${newData}/${name}`,snap=await tracked(p,oldPath)
        if(!snap.bytes)throw new StructuralError(`Missing ${name} for slide duplicate`,422)
        let bytes=snap.bytes
        if(name!=='notes.json') {const obj=JSON.parse(bytes.toString());if(name==='scene.json'){obj.id=id;obj.localDuplicateOf=current.id}
          else obj.slideId=id;bytes=json(obj)}
        await set(p,newPath,bytes)
      }
      const duplicate={...current,id,page:newPage,data:newData,order:position+2,label:`${current.label??current.id} copy`,localDuplicateOf:current.id}
      p.index.splice(p.index.indexOf(current)+1,0,duplicate)
      p.overlay.slides[id]={state:'active',duplicateOf:current.id}
      const originals=owned(source),copies=owned(copy)
      for(let i=0;i<Math.min(originals.length,copies.length);i++)p.overlay.objects[copies[i].id]={origin:'local-duplicate',state:'active',sourceSlideId:current.id,
        currentSlideId:id,sourceFile:newPage,duplicateOf:originals[i].id}
      focusNo=position+2
    }
    else {
      if(action.beforeSlideId===current.id)throw new StructuralError('Slide cannot reorder before itself',422)
      const target=action.beforeSlideId?row(p,action.beforeSlideId):null,without=active(p).filter(r=>r.id!==current.id),at=target?without.findIndex(r=>r.id===target.id):without.length
      without.splice(at,0,current)
      without.forEach((r,i)=>{r.order=i+1})
      const skipped=p.index.filter(r=>r.skipped);p.index=[...without,...skipped]
      p.overlay.slides[current.id]={state:'reordered'}
      focusNo=at+1
    }
    const newRows=active(p),newIds=newRows.map(r=>r.id)
    newRows.forEach((r,i)=>{r.order=i+1})
    const imports=managedImports(p.slides,oldRows.map(r=>r.page))
    await set(p,'slides.md',Buffer.from(imports(newRows.map(r=>r.page))))
    // Numeric navigation targets point at logical slide IDs after reordering.
    for(const r of newRows){await tracked(p,r.page);const before=asString(p,r.page),after=navPatch(before,oldIds,newIds)
      if(after!==before)await set(p,r.page,Buffer.from(after))}
    await set(p,'data/slides/index.json',json(p.index))
  }
  else throw new StructuralError('Unsupported structural command',422)
  await set(p,'data/structural-provenance.json',json(p.overlay))
  await candidatePages(p)
  const changes:Change[]=[]
  for(const [path,next] of p.candidates){const prior=p.versions.get(path)!
    if((next===null&&prior.bytes===null)||(next!==null&&prior.bytes!==null&&next.equals(prior.bytes)))continue
    changes.push({path,expected:prior.revision,next})}
  if(!changes.length)throw new StructuralError('Structural no-op',422)
  const guards=[...p.guards.values()].filter(g=>!p.candidates.has(g.path))
  return {store:p.store,plan:{label:`${action.kind} ${action.action}`,changes,guards},anchor,focusNo,total:active(p).length}
}
