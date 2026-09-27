import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest'
import {effectScope,shallowRef,nextTick} from 'vue'
import {parseManagedLayer} from '../shared/managed-layer'
import type {LayerState} from '../client/managed-layer-editor'
import {useLayerGeometryGizmo} from '../client/composables/useLayerGeometryGizmo'
const stub=vi.hoisted(()=>({handlers:new Map<string,Function[]>(),host:null as any,active:null as any,selected:null as any,error:null as any,snap:null as any,command:vi.fn()}))
vi.mock('../client/composables/useDomEvent',()=>({onDomEvent:(_target:unknown,event:string,fn:Function)=>{stub.handlers.set(event,[...(stub.handlers.get(event)??[]),fn])}}))
vi.mock('../client/managed-layer-editor',()=>({get activeLayer(){return stub.active},get selectedLayers(){return stub.selected},get layerError(){return stub.error},layerHost:()=>stub.host,layerCommand:(...args:unknown[])=>stub.command(...args)}))
vi.mock('../client/state',()=>({get snapEnabled(){return stub.snap}}))
const source='<StudioLayer version="1" id="public-image" slide-id="public" source-id="public:1" source-type="RECTANGLE" kind="image" pos="100,80,200,120" rotate="0" rotation="true" capability="FULL"><img src="/synthetic.png" /></StudioLayer>'
let scope:ReturnType<typeof effectScope>,styles:Record<string,string>,initial:string,state:LayerState,gizmo:ReturnType<typeof useLayerGeometryGizmo>
const event=(x:number,y:number,extra={})=>({button:0,clientX:x,clientY:y,preventDefault(){},stopPropagation(){},altKey:false,shiftKey:false,...extra}) as PointerEvent
const dispatch=async(name:string,e:unknown)=>{for(const fn of stub.handlers.get(name)??[])await fn(e)}
function setup(scale=1){
  state={no:1,id:'public-image',document:parseManagedLayer(source),revision:'a'.repeat(64),filePath:'public.md'}
  styles={left:'100px',top:'80px',width:'200px',height:'120px',transform:'rotate(0deg)'};initial=JSON.stringify(styles)
  stub.active=shallowRef(state);stub.selected=shallowRef([state]);stub.error=shallowRef(null);stub.snap=shallowRef(false)
  stub.host={isConnected:true,dataset:{studioLayerPos:'100,80,200,120',studioLayerRotate:'0'},style:styles,getAttribute:()=>initial,setAttribute:(_k:string,s:string)=>{for(const k of Object.keys(styles))delete styles[k];Object.assign(styles,JSON.parse(s))},removeAttribute(){}}
  const canvas={rect:shallowRef({left:10,top:20,width:1920*scale,height:1080*scale}),scale:shallowRef(scale),el:shallowRef({querySelectorAll:()=>[]}),boxOf:()=>({x:500,y:400,w:200,h:120})} as any
  scope=effectScope();scope.run(()=>{gizmo=useLayerGeometryGizmo(canvas)})
}
beforeEach(()=>{stub.handlers.clear();stub.command.mockReset();vi.stubGlobal('window',{});setup()})
afterEach(()=>{scope?.stop();vi.unstubAllGlobals()})
describe('OE0A actual gesture event path (synthetic event harness)',()=>{
  it.each(['move','resize','rotate'] as const)('%s previews without source/history; cancel discards preview',async kind=>{
    const p=kind==='rotate'?event(210,40):event(210,160)
    if(kind==='move')gizmo.startMove(p);else if(kind==='resize')gizmo.startResize(p,'se');else gizmo.startRotate(p)
    await dispatch('pointermove',event(p.clientX+40,p.clientY+20));expect(stub.command).not.toHaveBeenCalled();expect(JSON.stringify(styles)).not.toBe(initial)
    await dispatch('pointercancel',{});expect(JSON.stringify(styles)).toBe(initial);expect(stub.command).not.toHaveBeenCalled()
  })
  it.each(['move','resize','rotate'] as const)('%s releases exactly one revision-guarded command',async kind=>{
    stub.command.mockResolvedValue(true);const p=kind==='rotate'?event(210,40):event(210,160)
    if(kind==='move')gizmo.startMove(p);else if(kind==='resize')gizmo.startResize(p,'se');else gizmo.startRotate(p)
    await dispatch('pointermove',event(p.clientX+40,p.clientY+20));await dispatch('pointermove',event(p.clientX+60,p.clientY+30));expect(stub.command).not.toHaveBeenCalled()
    await dispatch('pointerup',{});await dispatch('pointerup',{});expect(stub.command).toHaveBeenCalledTimes(1);expect(stub.command.mock.calls[0][1]).toBe(state.revision)
  })
  it.each(['move','resize','rotate'] as const)('stale %s keeps revision B and has zero writes/history',async kind=>{
    let authoritative='revision A',writes=0,history=0
    stub.command.mockImplementation(async(_edit,revision)=>{if(revision!==authoritative)return false;writes++;history++;return true})
    const p=kind==='rotate'?event(210,40):event(210,160)
    if(kind==='move')gizmo.startMove(p);else if(kind==='resize')gizmo.startResize(p,'se');else gizmo.startRotate(p)
    await dispatch('pointermove',event(p.clientX+40,p.clientY+20));authoritative='revision B manual edit'
    await dispatch('pointerup',{});expect(authoritative).toBe('revision B manual edit');expect(writes).toBe(0);expect(history).toBe(0);expect(JSON.stringify(styles)).toBe(initial)
  })
  it('own committed revision does not falsely cancel a completed preview',async()=>{
    stub.command.mockImplementation(async()=>{stub.active.value={...state,revision:'b'.repeat(64)};await nextTick();return true})
    gizmo.startMove(event(210,160));await dispatch('pointermove',event(250,180));await dispatch('pointerup',{});expect(stub.error.value).toBe(null);expect(stub.command).toHaveBeenCalledTimes(1)
  })
  it('HMR revision refresh cancels a held gesture and keeps rendered manual geometry',async()=>{
    gizmo.startMove(event(210,160));await dispatch('pointermove',event(250,180))
    styles.left='333px';stub.host.dataset.studioLayerPos='333,80,200,120';stub.active.value={...state,revision:'b'.repeat(64),document:{...state.document,geometry:{...state.document.geometry,x:333}}};await nextTick()
    await dispatch('pointerup',{});expect(stub.command).not.toHaveBeenCalled();expect(styles.left).toBe('333px');expect(stub.error.value).toContain('preview cancelled')
  })
  it.each([.5,1,2])('equivalent drag/resize at %s scale persists identical slide geometry',async scale=>{
    scope.stop();stub.handlers.clear();setup(scale);stub.command.mockResolvedValue(true)
    const p=event(10+200*scale,20+140*scale);gizmo.startMove(p);await dispatch('pointermove',event(p.clientX+20*scale,p.clientY+10*scale));await dispatch('pointerup',{})
    expect(stub.command.mock.calls[0][0].geometry).toMatchObject({x:120,y:90,width:200,height:120})
    stub.command.mockClear();gizmo.startResize(p,'se');await dispatch('pointermove',event(p.clientX+40*scale,p.clientY+20*scale));await dispatch('pointerup',{})
    expect(stub.command.mock.calls[0][0].geometry).toMatchObject({x:100,y:80,width:240,height:140})
  })
  it.each([{x:5,y:80,want:0},{x:865,y:80,want:860},{x:499,y:80,want:499}])('shared snapping uses slide edge/center and Alt bypass ($want)',async({x,y,want})=>{
    stub.snap.value=true;stub.command.mockResolvedValue(true);gizmo.startMove(event(210,160));await dispatch('pointermove',event(210+x-100,160+y-80));await dispatch('pointerup',{})
    expect(stub.command.mock.calls[0][0].geometry.x).toBe(want)
    stub.command.mockClear();gizmo.startMove(event(210,160));await dispatch('pointermove',event(210+x-100,160+y-80,{altKey:true}));await dispatch('pointerup',{});expect(stub.command.mock.calls[0][0].geometry.x).toBe(x)
  })
})
