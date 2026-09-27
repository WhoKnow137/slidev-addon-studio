import { NodeTypes, parse } from '@vue/compiler-dom'
import type { ElementNode, SourceLocation } from '@vue/compiler-dom'
import type { SourceSpan, TextDocument } from './studiotext'
import { applyGeometry, geometryNumber, normalizeAngle } from './geometry'
import type { GeometryEdit } from './geometry'

export type LayerKind = 'image' | 'gif' | 'video' | 'shape' | 'vector' | 'frame' | 'instance'
export type CapabilityLevel = 'FULL' | 'POSITION_ONLY' | 'READ_ONLY' | 'UNAVAILABLE'
export interface LayerGeometry { x: number, y: number, width: number, height: number, rotationDeg: number }
export interface ManagedLayer {
  version: 1
  id: string
  slideId: string
  source: { figmaGuid: string, kiwiType: string, instancePath: string[] }
  parentId?: string
  kind: LayerKind
  geometry: LayerGeometry
  capabilities: { level: CapabilityLevel, reason: string, rotation: boolean }
}
export type LayerEdit = Extract<GeometryEdit, { kind: 'set' | 'translate' | 'resize' }>
  | { kind: 'frame', geometry: LayerGeometry }
const kinds = new Set(['image','gif','video','shape','vector','frame','instance'])
const levels = new Set(['FULL','POSITION_ONLY','READ_ONLY','UNAVAILABLE'])
const attributes = new Set(['version','id','slide-id','source-id','source-type','instance-path','parent-id','kind','pos','rotate','capability','reason','rotation','class'])
const fail = (reason: string): never => { throw Error(reason) }
function element(source: string): ElementNode {
  const errors: string[]=[]
  const ast=parse(source,{comments:true,whitespace:'preserve',onError:e=>errors.push(e.message)})
  if(errors.length)fail(`Invalid layer source: ${errors[0]}`)
  const roots=ast.children.filter(n=>n.type!==NodeTypes.COMMENT && !(n.type===NodeTypes.TEXT&&!n.content.trim()))
  if(roots.length!==1 || roots[0].type!==NodeTypes.ELEMENT || roots[0].tag!=='StudioLayer')fail('Expected one StudioLayer')
  return roots[0] as ElementNode
}
export function parseManagedLayer(source: string): ManagedLayer {
  const root=element(source), values: Record<string,string>={}
  for(const p of root.props){
    if(p.type!==NodeTypes.ATTRIBUTE || !attributes.has(p.name) || Object.hasOwn(values,p.name) || !p.value)throw Error('Layer attributes must be unique supported literals')
    values[p.name]=p.value.content
  }
  if(values.version!=='1' || !values.id || values.id.length>256 || !values['slide-id'] || !values['source-id'] || !values['source-type'])fail('Layer identity/version missing')
  if(!kinds.has(values.kind)||!levels.has(values.capability))fail('Unsupported layer kind/capability')
  const parts=values.pos?.split(',').map(Number)
  if(!parts||parts.length!==4||parts.some(n=>!Number.isFinite(n)||Math.abs(n)>1e9)||parts[2]<=0||parts[3]<=0)fail('Invalid layer frame')
  const rotation=Number(values.rotate??0)
  if(!Number.isFinite(rotation)||Math.abs(rotation)>1e9)fail('Invalid layer rotation')
  if(values.rotation!==undefined&&!['true','false'].includes(values.rotation))fail('Invalid rotation capability')
  return {version:1,id:values.id,slideId:values['slide-id'],source:{figmaGuid:values['source-id'],kiwiType:values['source-type'],instancePath:values['instance-path']?.split('/').filter(Boolean)??[]},
    ...(values['parent-id']?{parentId:values['parent-id']}:{}),kind:values.kind as LayerKind,
    geometry:{x:parts[0],y:parts[1],width:parts[2],height:parts[3],rotationDeg:normalizeAngle(rotation)},
    capabilities:{level:values.capability as CapabilityLevel,reason:values.reason??'',rotation:values.rotation==='true'}}
}
function mask(source:string){
  const chars=source.split('');let offset=0,fence='',front=/^---\r?\n/.test(source)
  for(const line of source.match(/[^\n]*\n|[^\n]+$/g)??[]){
    const marker=line.match(/^ {0,3}(`{3,}|~{3,})/)
    if(front||fence||marker)for(let i=0;i<line.length;i++)if(!['\n','\r'].includes(line[i]))chars[offset+i]=' '
    if(front&&offset>0&&line.trim()==='---')front=false
    else if(fence&&marker?.[1][0]===fence[0]&&marker[1].length>=fence.length)fence=''
    else if(!fence&&marker)fence=marker[1]
    offset+=line.length
  }
  return chars.join('')
}
/** Only root-owned wrappers are writable. Nested wrappers are inspected through their owner. */
export function managedLayerSpans(source:string):SourceSpan[]{
  const errors:string[]=[],root=parse(mask(source),{comments:true,whitespace:'preserve',onError:e=>errors.push(e.message)})
  if(errors.length)fail(`Unsupported layer source structure: ${errors[0]}`)
  const spans:SourceSpan[]=[]
  for(const n of root.children){
    if(n.type!==NodeTypes.ELEMENT||n.tag!=='StudioLayer')continue
    const raw=source.slice(n.loc.start.offset,n.loc.end.offset),model=parseManagedLayer(raw)
    spans.push({id:model.id,start:n.loc.start.offset,end:n.loc.end.offset,source:raw})
  }
  return spans
}
export function uniqueManagedLayer(source:string,id:string):SourceSpan{
  const list=managedLayerSpans(source).filter(s=>s.id===id)
  if(list.length!==1)fail(list.length?'Ambiguous managed layer identity':'Managed layer not found')
  return list[0]
}
export function applyLayerGeometry(layer:ManagedLayer,edit:LayerEdit):ManagedLayer{
  const {level,rotation}=layer.capabilities
  if(level==='READ_ONLY'||level==='UNAVAILABLE'||layer.parentId)fail(layer.capabilities.reason||'Layer geometry is read-only')
  if(!edit||!['set','translate','resize','frame'].includes(edit.kind))fail('Unsupported layer geometry command')
  const g=layer.geometry
  if(edit.kind==='set'&&!['x','y','width','height','rotationDeg'].includes(edit.property))fail('Unsupported geometry property')
  if(edit.kind==='resize'&&!['n','s','e','w','nw','ne','sw','se'].includes(edit.handle))fail('Unsupported resize handle')
  if(edit.kind==='frame'){
    if(!edit.geometry||Object.keys(g).some(k=>!Number.isFinite(edit.geometry[k as keyof LayerGeometry])))fail('Invalid layer frame')
    if(level!=='FULL'&&(edit.geometry.width!==g.width||edit.geometry.height!==g.height))fail('Layer resize unavailable: topology/constraints preserved')
    if(!rotation&&edit.geometry.rotationDeg!==g.rotationDeg)fail('Layer rotation unavailable')
  }
  if(level!=='FULL'&&(edit.kind==='resize'||(edit.kind==='set'&&['width','height'].includes(edit.property))))fail('Layer resize unavailable: topology/constraints preserved')
  if(!rotation&&edit.kind==='set'&&edit.property==='rotationDeg')fail('Layer rotation unavailable')
  // Reuse M3 frame/rotation/rotated-resize mathematics; no text or Scale semantics are emitted.
  const carrier={geometry:{...g},resizeMode:'fixed'} as TextDocument
  const next=applyGeometry(carrier,edit.kind==='frame'?{...edit,mode:'fixed'}:edit).geometry
  if(next.width===null||next.height===null)throw Error('Layer dimensions must remain fixed')
  return {...layer,geometry:{x:geometryNumber(next.x),y:geometryNumber(next.y),width:next.width,height:next.height,rotationDeg:next.rotationDeg}}
}
export function patchLayerGeometrySource(source:string,before:ManagedLayer,after:ManagedLayer):string{
  if(before.id!==after.id)fail('Layer identity cannot change')
  const root=element(source),changes:Record<string,string>={},a=after.geometry,b=before.geometry
  const pos=(g:LayerGeometry)=>[g.x,g.y,g.width,g.height].map(geometryNumber).join(',')
  if(pos(a)!==pos(b))changes.pos=pos(a)
  if(a.rotationDeg!==b.rotationDeg)changes.rotate=String(normalizeAngle(a.rotationDeg))
  const patches:{loc:SourceLocation,text:string}[]=[]
  for(const p of root.props)if(p.type===NodeTypes.ATTRIBUTE&&Object.hasOwn(changes,p.name)){patches.push({loc:p.loc,text:`${p.name}="${changes[p.name]}"`});delete changes[p.name]}
  if(Object.keys(changes).length)fail('Managed geometry attributes missing')
  const next=patches.sort((a,b)=>b.loc.start.offset-a.loc.start.offset).reduce((s,p)=>s.slice(0,p.loc.start.offset)+p.text+s.slice(p.loc.end.offset),source)
  parseManagedLayer(next);return next
}
