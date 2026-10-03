import {shallowRef,watch} from 'vue'
import {screenToSlide,slideToScreen,snapAngle} from '../../shared/geometry'
import type {Handle,CanvasTransform,Point} from '../../shared/geometry'
import {applyLayerGeometry} from '../../shared/managed-layer'
import type {LayerEdit,ManagedLayer} from '../../shared/managed-layer'
import {activeLayer,selectedLayers,layerHost,layerCommand,layerError} from '../managed-layer-editor'
import {snapEnabled} from '../state'
import {snapBox} from './useSnapping'
import type {Guide} from './useSnapping'
import {onDomEvent} from './useDomEvent'
import type {useSlideCanvas} from './useSlideCanvas'
type Gesture={kind:'move'}|{kind:'resize',handle:Handle}|{kind:'rotate'}
export function useLayerGeometryGizmo(canvas:ReturnType<typeof useSlideCanvas>){
  const guides=shallowRef<Guide[]>([])
  let running:{gesture:Gesture,states:typeof selectedLayers.value,items:{host:HTMLElement,style:string|null,model:ManagedLayer}[],transform:CanvasTransform,start:Point,startAngle:number,draft:ManagedLayer,moved:boolean,committing:boolean}|null=null
  const restore=()=>{for(const item of running?.items??[])if(item.host.isConnected && item.host.dataset.studioLayerPos===[item.model.geometry.x,item.model.geometry.y,item.model.geometry.width,item.model.geometry.height].join(',') && Number(item.host.dataset.studioLayerRotate)===item.model.geometry.rotationDeg){if(item.style===null)item.host.removeAttribute('style');else item.host.setAttribute('style',item.style)}running=null;guides.value=[]}
  watch(()=>activeLayer.value?.revision,(revision)=>{if(running&&!running.committing&&revision!==running.states[0].revision){layerError.value='Source changed during gesture; preview cancelled';restore()}})
  function start(e:PointerEvent,gesture:Gesture){
    const state=activeLayer.value,states=selectedLayers.value
    if(e.button!==0||!state||!states.length)return
    if(states.some(s=>['READ_ONLY','UNAVAILABLE'].includes(s.document.capabilities.level))||states.length>1&&gesture.kind!=='move')return
    if(gesture.kind==='resize'&&state.document.capabilities.level!=='FULL'||gesture.kind==='rotate'&&!state.document.capabilities.rotation)return
    const items=states.map(s=>{const host=layerHost(s.no,s.id);if(!host||host.dataset.studioLayerPos!==[s.document.geometry.x,s.document.geometry.y,s.document.geometry.width,s.document.geometry.height].join(','))return null;return {host,style:host.getAttribute('style'),model:s.document}})
    if(items.some(i=>!i)){layerError.value='Rendered/source geometry revision mismatch';return}
    const transform={left:canvas.rect.value.left,top:canvas.rect.value.top,scale:canvas.scale.value}
    const start=screenToSlide({x:e.clientX,y:e.clientY},transform),g=state.document.geometry
    e.preventDefault();e.stopPropagation()
    running={gesture,states:[...states],items:items as NonNullable<typeof items[number]>[],transform,start,startAngle:Math.atan2(start.y-g.y-g.height/2,start.x-g.x-g.width/2)*180/Math.PI,draft:state.document,moved:false,committing:false}
  }
  onDomEvent<PointerEvent>(window,'pointermove',e=>{
    const r=running;if(!r)return
    if(activeLayer.value?.id!==r.states[0].id){restore();return}
    const p=screenToSlide({x:e.clientX,y:e.clientY},r.transform),dx=p.x-r.start.x,dy=p.y-r.start.y
    const screenStart=slideToScreen(r.start,r.transform);if(!r.moved&&Math.hypot(e.clientX-screenStart.x,e.clientY-screenStart.y)<4)return
    r.moved=true;const model=r.items[0].model,g=model.geometry
    let edit:LayerEdit=r.gesture.kind==='move'?{kind:'translate',dx,dy}:r.gesture.kind==='resize'?{kind:'resize',handle:r.gesture.handle,dx,dy,measurement:{width:g.width,height:g.height}}:{kind:'set',property:'rotationDeg',value:snapAngle(g.rotationDeg+Math.atan2(p.y-g.y-g.height/2,p.x-g.x-g.width/2)*180/Math.PI-r.startAngle,e.shiftKey)}
    try{
      let draft=applyLayerGeometry(model,edit)
      if(r.gesture.kind==='move'&&snapEnabled.value&&!e.altKey&&g.rotationDeg===0){
        const ids=r.states.map(s=>s.id),others=[...(canvas.el.value?.querySelectorAll<HTMLElement>('[data-studio-object-id],[data-studio-text-id]')??[])].filter(h=>!ids.includes(h.dataset.studioObjectId??'')).map(h=>canvas.boxOf(h))
        const d=draft.geometry,snap=snapBox({x:d.x,y:d.y,w:d.width,h:d.height},{canvas:{w:canvas.rect.value.width/r.transform.scale,h:canvas.rect.value.height/r.transform.scale},others,threshold:6/r.transform.scale})
        draft=applyLayerGeometry(model,{kind:'translate',dx:snap.box.x-g.x,dy:snap.box.y-g.y});guides.value=snap.guides
      }else guides.value=[]
      r.draft=draft
      for(const [index,item] of r.items.entries()){
        const value=index?applyLayerGeometry(item.model,{kind:'translate',dx:draft.geometry.x-g.x,dy:draft.geometry.y-g.y}):draft
        const frame=value.geometry;item.host.style.left=`${frame.x}px`;item.host.style.top=`${frame.y}px`;item.host.style.width=`${frame.width}px`;item.host.style.height=`${frame.height}px`;item.host.style.transform=`rotate(${frame.rotationDeg}deg)`
      }
    }catch(e){layerError.value=(e as Error).message;restore()}
  })
  onDomEvent<PointerEvent>(window,'pointerup',async()=>{
    const r=running;if(!r)return
    if(!r.moved){restore();return}
    const g=r.items[0].model.geometry,d=r.draft.geometry
    const edit:LayerEdit=r.states.length>1?{kind:'translate',dx:d.x-g.x,dy:d.y-g.y}:{kind:'frame',geometry:d}
    r.committing=true
    const success=await layerCommand(edit,r.states[0].revision,r.states)
    if(running!==r)return
    if(!success)restore();else{running=null;guides.value=[]}
  })
  onDomEvent<PointerEvent>(window,'pointercancel',restore)
  onDomEvent<KeyboardEvent>(window,'keydown',e=>{if(e.key==='Escape'&&running){e.preventDefault();restore()}},{capture:true})
  return {guides,startMove:(e:PointerEvent)=>start(e,{kind:'move'}),startResize:(e:PointerEvent,handle:Handle)=>start(e,{kind:'resize',handle}),startRotate:(e:PointerEvent)=>start(e,{kind:'rotate'})}
}
