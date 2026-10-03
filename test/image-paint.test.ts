import {it,expect} from 'vitest'
import {inspectImagePaint,refuseImagePaintMutation} from '../shared/image-paint'
import {parseManagedLayer,applyLayerGeometry,patchLayerGeometrySource} from '../shared/managed-layer'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {ResolvedSlidevOptions} from '@slidev/types'
import {StudioTextService} from '../node/studio-text-service'
const paint={type:'IMAGE',imageScaleMode:'STRETCH',transform:{m00:.75,m01:.1,m02:.125,m10:-.1,m11:.9,m12:-.2},
  originalImageWidth:400,originalImageHeight:300,opacity:.4,visible:true,image:{hash:[1,2,3]},future:{opaque:['keep',7]}}
const evidence=()=>({version:1,scope:'synthetic',sourceNodeId:'synthetic:image',orderedPaints:[paint],
  layer:{opacity:.5,cornerRadius:8,effects:[{type:'unverified',opaque:42}]},placements:[{sourcePath:'fillPaints[0]',
    resource:{sourceHash:'010203',sha256:'a'.repeat(64),url:'/media/shared.png',member:'images/010203'},poster:null,thumbnail:null,
    rendererProjection:{scope:'renderer-only',style:{objectFit:'fill'}}}]})
const attr=(s:string)=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const source=()=>`<StudioLayer version="1" id="image-a" slide-id="slide-a" source-id="synthetic:image" source-type="RECTANGLE" kind="image" pos="10,20,200,100" rotate="0" capability="FULL" rotation="true" paint-evidence="${attr(JSON.stringify(evidence()))}"><DeckImage src="/media/shared.png" /></StudioLayer>`
it('retains complete raw paint, resource and appearance evidence without assigning crop semantics',()=>{
 const value=inspectImagePaint(JSON.stringify(evidence()),'image-a')
 expect(value.ownership).toBe('single-image-paint');expect(value.persistentPaintId).toBeNull();expect(value.mode).toBe('unknown')
 expect(value.matrixDirection).toBe('unknown');expect(value.coordinateSpace).toBe('unknown');expect(value.writable).toBe(false)
 expect(value.evidence).toEqual(evidence());expect(value.images[0].rawMode).toBe('STRETCH')
 expect(value.images[0].rawMatrix).toEqual(paint.transform);expect(value.images[0].paintOpacity).toBe(.4)
 expect(value.evidence.layer.opacity).toBe(.5);expect(value.evidence.placements[0].resource.sourceHash).not.toBe(value.ownerLayerId)
})
it('hidden paints and overlays make stack ownership ambiguous rather than filtering an editable sole paint',()=>{
 const e=evidence();e.orderedPaints.push({...paint,visible:false})
 expect(inspectImagePaint(JSON.stringify(e),'image-a').ownership).toBe('ambiguous-paint-stack')
 const overlay={...evidence(),orderedPaints:[{type:'SOLID',color:{r:1,g:0,b:0}},paint]}
 expect(inspectImagePaint(JSON.stringify(overlay),'image-a').ownership).toBe('ambiguous-paint-stack')
})
it('missing private fields remain absent and a rendering projection never determines a typed mode',()=>{
 const e={...evidence(),orderedPaints:[{type:'IMAGE'}]}
 const value=inspectImagePaint(JSON.stringify(e),'image-a')
 expect(value.images[0]).toMatchObject({rawMode:null,rawMatrix:null,intrinsicWidth:null,paintOpacity:null})
 expect(value.evidence.orderedPaints[0]).toEqual({type:'IMAGE'});expect(value.mode).toBe('unknown')
})
it('rejects malformed or oversized evidence; no partial semantic contract is returned',()=>{
 for(const e of [{...evidence(),version:2},{...evidence(),orderedPaints:['unsafe']},{...evidence(),layer:null}])
   expect(()=>inspectImagePaint(JSON.stringify(e),'image-a')).toThrow()
 expect(()=>inspectImagePaint(' '.repeat(1_000_001),'image-a')).toThrow('limit')
})
it('geometry changes preserve the exact paint attribute and render slot',()=>{
 const before=source(),model=parseManagedLayer(before),next=patchLayerGeometrySource(before,model,applyLayerGeometry(model,{kind:'set',property:'width',value:300}))
 expect(next.replace('pos="10,20,300,100"','pos="10,20,200,100"')).toBe(before)
 expect(parseManagedLayer(next).paintInspection).toEqual(model.paintInspection)
})
it('a duplicate owner derives its inspection owner from current source without cloning a native paint ID',()=>{
 const a=parseManagedLayer(source()),b=parseManagedLayer(source().replace('id="image-a"','id="local-m6-00000001"'))
 expect(b.paintInspection?.ownerLayerId).not.toBe(a.paintInspection?.ownerLayerId)
 expect(b.paintInspection?.persistentPaintId).toBeNull();expect(b.paintInspection?.evidence).toEqual(a.paintInspection?.evidence)
})
it('every private mutation request is refused while native evidence remains unresolved',()=>{
 expect(refuseImagePaintMutation).toThrow('BLOCKED')
})
it('service inspection has zero writes/history and guarded layer undo restores exact paint evidence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'oe2-inspection-'));try{
 const file=join(root,'slides.md'),before='---\ntitle: Synthetic\n---\n\n'+source()+'\n\n<!-- public notes -->\n';await writeFile(file,before)
 const options={data:{entry:{filepath:file},slides:[{source:{filepath:file,index:0}}]}} as unknown as ResolvedSlidevOptions
 const service=new StudioTextService(options),state=await service.layerStatus(1,'image-a','inspection-session')
 expect(state.document.paintInspection?.writable).toBe(false);expect(await readFile(file,'utf8')).toBe(before)
 expect((await service.historyStatus('inspection-session')).canUndo).toBe(false)
 const next=await service.layerCommand({action:'geometry',no:1,id:'image-a',session:'inspection-session',expectedRevision:state.handle.expectedRevision,geometryEdit:{kind:'translate',dx:5,dy:0}})
 expect(next.document.paintInspection).toEqual(state.document.paintInspection)
 await service.historyCommand({action:'undo',no:1,session:'inspection-session',expectedRevision:next.revision})
 expect(await readFile(file,'utf8')).toBe(before)
 }finally{await rm(root,{recursive:true,force:true})}
})
