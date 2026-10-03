import {describe,it,expect,beforeEach,afterEach} from 'vitest'
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import type {ResolvedSlidevOptions} from '@slidev/types'
import {parseManagedLayer,managedLayerSpans,uniqueManagedLayer,applyLayerGeometry,patchLayerGeometrySource} from '../shared/managed-layer'
import type {LayerEdit} from '../shared/managed-layer'
import {screenToSlide,rotateVector} from '../shared/geometry'
import {snapBox} from '../client/composables/useSnapping'
import {StudioTextService} from '../node/studio-text-service'
const layer=(id='image',kind='image',capability='FULL')=>`<StudioLayer version="1" id="${id}" slide-id="s1" source-id="1:2" source-type="RECTANGLE" kind="${kind}" pos="100,80,200,120" rotate="0" rotation="true" capability="${capability}" reason="Synthetic geometry policy"><img src="/synthetic.png" data-paint-matrix="1,0,0,1,0.2,0" /></StudioLayer>`
const text='<StudioText version="1" id="text" pos="20,20,160,60" resize="fixed" rotate="0" font-size="24">Public synthetic text</StudioText>'
const fixture=`---\ntitle: Synthetic\n---\n\nUnrelated Markdown.\n\n${layer()}\n\n${layer('shape','shape','POSITION_ONLY')}\n\n${text}\n\n<!-- Synthetic notes -->\n`
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
let dir:string,file:string,service:StudioTextService
beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),'oe0a-service-'));file=join(dir,'slide.md');await writeFile(file,fixture);service=new StudioTextService({data:{slides:[{source:{filepath:file,index:0}}]}} as unknown as ResolvedSlidevOptions)})
afterEach(async()=>{await rm(dir,{recursive:true,force:true})})
const read=()=>readFile(file,'utf8')
const command=(edit:LayerEdit,revision:string,ids=['image'])=>service.layerCommand({action:'geometry',no:1,id:ids[0],ids,session:'oe0a-session',expectedRevision:revision,geometryEdit:edit})
describe('OE0A managed source foundation',()=>{
  it('parses a versioned minimal source-aware contract; identity does not change with geometry',()=>{
    const source=layer(),model=parseManagedLayer(source),next=applyLayerGeometry(model,{kind:'translate',dx:20,dy:5}),changed=patchLayerGeometrySource(source,model,next)
    expect(next.id).toBe(model.id);expect(next.source).toEqual(model.source);expect(changed.replace('120,85,200,120','100,80,200,120')).toBe(source)
  })
  it('ignores fenced examples/comments and refuses duplicate IDs/dynamic geometry',()=>{
    expect(managedLayerSpans('```vue\n'+layer()+'\n```\n<!-- '+layer()+' -->')).toHaveLength(0)
    expect(()=>uniqueManagedLayer(layer()+layer(),'image')).toThrow('Ambiguous')
    expect(()=>parseManagedLayer(layer().replace('pos=','v-bind:pos='))).toThrow()
    expect(()=>parseManagedLayer(layer().replace('version="1"','version="2"'))).toThrow()
  })
  it.each(['translate','resize','rotation','numeric'] as const)('stale %s refuses without writes or history',async kind=>{
    const external=fixture+'\nManual edit.\n';await writeFile(file,external)
    const edit:LayerEdit=kind==='translate'?{kind,dx:100,dy:20}:kind==='resize'?{kind,handle:'se',dx:50,dy:20,measurement:{width:200,height:120}}:{kind:'set',property:kind==='rotation'?'rotationDeg':'x',value:30}
    await expect(command(edit,hash(fixture))).rejects.toMatchObject({status:409});expect(await read()).toBe(external);expect((await service.historyStatus('oe0a-session')).canUndo).toBe(false)
  })
  it.each<LayerEdit>([{kind:'translate',dx:10,dy:5},{kind:'set',property:'width',value:300},{kind:'set',property:'height',value:180},{kind:'set',property:'rotationDeg',value:30}])('$kind writes once, preserves slot/unrelated bytes, reloads, undoes and redoes exactly',async edit=>{
    const first=await command(edit,hash(fixture)),after=await read(),s=uniqueManagedLayer(after,'image')
    expect(after.slice(0,s.start)).toBe(fixture.slice(0,uniqueManagedLayer(fixture,'image').start))
    expect(after.slice(s.end)).toBe(fixture.slice(uniqueManagedLayer(fixture,'image').end))
    expect(s.source.slice(s.source.indexOf('<img'))).toBe(layer().slice(layer().indexOf('<img')))
    expect((await service.layerStatus(1,'image')).document.id).toBe('image')
    const undo=await service.historyCommand({action:'undo',no:1,session:'oe0a-session',expectedRevision:first.revision});expect(await read()).toBe(fixture)
    await service.historyCommand({action:'redo',no:1,session:'oe0a-session',expectedRevision:undo.revision});expect(await read()).toBe(after)
  })
  it('batch translation validates all owners and records one undo entry',async()=>{
    const first=await command({kind:'translate',dx:40,dy:-10},hash(fixture),['image','shape']);const after=await read()
    expect(managedLayerSpans(after).map(s=>parseManagedLayer(s.source).geometry.x)).toEqual([140,140])
    await service.historyCommand({action:'undo',no:1,session:'oe0a-session',expectedRevision:first.revision});expect(await read()).toBe(fixture);expect((await service.historyStatus('oe0a-session')).canUndo).toBe(false)
  })
  it('shared history resolves the latest owner across files and nonfirst source slides',async()=>{
    const other=join(dir,'second.md'),deck='---\ntitle: Public\n---\n'+text+'\n---\n'+layer('second-image')+'\n';await writeFile(other,deck)
    service=new StudioTextService({data:{slides:[{source:{filepath:file,index:0}},{source:{filepath:other,index:0}},{source:{filepath:other,index:1}}]}} as unknown as ResolvedSlidevOptions)
    const a=await command({kind:'translate',dx:3,dy:0},hash(fixture)),firstAfter=await read()
    await service.layerCommand({action:'geometry',no:3,id:'second-image',session:'oe0a-session',expectedRevision:hash(deck),geometryEdit:{kind:'translate',dx:4,dy:0}})
    const h=await service.historyStatus('oe0a-session');expect(h.undoHead?.no).toBe(3)
    const u=await service.historyCommand({action:'undo',no:1,session:'oe0a-session',expectedRevision:h.undoHead!.revision});expect(u.no).toBe(3);expect(await readFile(other,'utf8')).toBe(deck);expect(await read()).toBe(firstAfter)
    const h2=await service.historyStatus('oe0a-session');await service.historyCommand({action:'undo',no:3,session:'oe0a-session',expectedRevision:h2.undoHead!.revision});expect(await read()).toBe(fixture)
  })
  it('text and layers share chronological history',async()=>{
    const move=await command({kind:'translate',dx:1,dy:0},hash(fixture)),moved=await read()
    const format=await service.command({action:'typography',no:1,id:'text',session:'oe0a-session',expectedRevision:move.revision,selection:{mode:'objects',ids:['text']},edit:{domain:'character',property:'fontSize',value:30}})
    const undoText=await service.historyCommand({action:'undo',no:1,session:'oe0a-session',expectedRevision:format.revision});expect(await read()).toBe(moved)
    const undoLayer=await service.historyCommand({action:'undo',no:1,session:'oe0a-session',expectedRevision:undoText.revision});expect(await read()).toBe(fixture)
    const redoLayer=await service.historyCommand({action:'redo',no:1,session:'oe0a-session',expectedRevision:undoLayer.revision})
    await service.historyCommand({action:'redo',no:1,session:'oe0a-session',expectedRevision:redoLayer.revision});expect(await read()).toContain('font-size="30"')
  })
  it('read-only, parent-local and position-only capabilities refuse destructive writes atomically',async()=>{
    const ro=fixture.replace('capability="FULL"','capability="READ_ONLY"');await writeFile(file,ro)
    await expect(command({kind:'translate',dx:10,dy:0},hash(ro))).rejects.toMatchObject({status:422});expect(await read()).toBe(ro)
    await writeFile(file,fixture)
    await expect(command({kind:'set',property:'width',value:300},hash(fixture),['shape'])).rejects.toMatchObject({status:422})
    await expect(command({kind:'resize',handle:'se',dx:20,dy:20,measurement:{width:200,height:120}},hash(fixture),['image','shape'])).rejects.toThrow();expect(await read()).toBe(fixture)
    expect(()=>applyLayerGeometry({...parseManagedLayer(layer()),parentId:'parent'},{kind:'translate',dx:10,dy:0})).toThrow()
  })
  it.each([0,30,90,-30])('rotated resize at %s uses M3 local axes and preserves opposite corner',angle=>{
    const m=parseManagedLayer(layer());m.geometry.rotationDeg=angle
    const delta=rotateVector({x:40,y:20},angle),next=applyLayerGeometry(m,{kind:'resize',handle:'se',dx:delta.x,dy:delta.y,measurement:{width:200,height:120}})
    expect(next.geometry.width).toBe(240);expect(next.geometry.height).toBe(140)
    const top=(g:typeof m.geometry)=>{const o=rotateVector({x:-g.width/2,y:-g.height/2},g.rotationDeg);return {x:g.x+g.width/2+o.x,y:g.y+g.height/2+o.y}}
    expect(top(next.geometry).x).toBeCloseTo(top(m.geometry).x,5);expect(top(next.geometry).y).toBeCloseTo(top(m.geometry).y,5)
  })
  it.each([0.25,0.5,1,2,4])('screen adapter at %s persists equivalent slide deltas',scale=>{
    const t={left:13,top:42,scale},a=screenToSlide({x:13+100*scale,y:42+80*scale},t),b=screenToSlide({x:13+130*scale,y:42+95*scale},t)
    expect([b.x-a.x,b.y-a.y]).toEqual([30,15])
  })
  it('shared snap engine uses slide and peer edges/centers with scaled tolerance',()=>{
    const base={canvas:{w:1000,h:600},others:[{x:100,y:100,w:100,h:100}],threshold:6}
    expect(snapBox({x:3,y:40,w:20,h:20},base).box.x).toBe(0)
    expect(snapBox({x:491,y:40,w:20,h:20},base).box.x).toBe(490)
    expect(snapBox({x:203,y:40,w:20,h:20},base).box.x).toBe(200)
    expect(snapBox({x:141,y:40,w:20,h:20},base).box.x).toBe(140)
  })
})
