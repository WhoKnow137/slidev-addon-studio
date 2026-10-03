import {shallowRef} from 'vue'
import type {LayerEdit,ManagedLayer} from '../shared/managed-layer'
import {sourceSession} from './source-session'
import {endStudioTextEdit,activeText,textSelection,refreshStudioText,inspectStudioText} from './studiotext-editor'
import {selection,studioOpen} from './state'
import {slideElement} from './dom'
export interface LayerState {no:number,id:string,document:ManagedLayer,revision:string,filePath:string}
export const activeLayer=shallowRef<LayerState|null>(null)
export const selectedLayers=shallowRef<LayerState[]>([])
export const layerError=shallowRef<string|null>(null),layerBusy=shallowRef(false)
let generation=0
export const layerHost=(no:number,id:string)=>slideElement(no)?.querySelector<HTMLElement>(`[data-studio-object-id="${CSS.escape(id)}"]`)??null
async function read(no:number,id:string):Promise<LayerState>{
  const response=await fetch(`/@studio/layer?no=${no}&id=${encodeURIComponent(id)}&session=${sourceSession()}`),r=await response.json()
  if(!response.ok)throw Error(r.error??'Layer source unavailable')
  return {no,id,document:r.document,revision:r.handle.expectedRevision,filePath:r.handle.filePath}
}
export function clearLayers(){generation++;activeLayer.value=null;selectedLayers.value=[];layerError.value=null}
export async function refreshLayers(){
  const states=selectedLayers.value;if(!states.length||layerBusy.value)return
  const token=++generation
  try{const next=await Promise.all(states.map(s=>read(s.no,s.id)));if(token!==generation)return
    if(next.some(s=>s.revision!==next[0].revision||s.filePath!==next[0].filePath))throw Error("Selection source revisions differ")
    selectedLayers.value=next;activeLayer.value=next[0];await sourceHistory.refresh()
  }catch(e){if(token===generation){clearLayers();layerError.value=(e as Error).message}}
}
export async function inspectLayer(host:HTMLElement,no:number,toggle=false){
  const id=host.dataset.studioObjectId;if(!id)return
  endStudioTextEdit();activeText.value=null
  const token=++generation
  try{
    const state=await read(no,id);if(token!==generation)return
    const prior=toggle&&selectedLayers.value.every(s=>s.no===no)?selectedLayers.value:[]
    const next=prior.some(s=>s.id===id)?prior.filter(s=>s.id!==id):[...prior,state]
    // Re-read peers against the same authoritative revision before batch ownership.
    const peers=await Promise.all(next.map(s=>read(no,s.id)))
    if(token!==generation)return
    if(peers.some(s=>s.filePath!==state.filePath||s.revision!==state.revision))throw Error('Selection spans different source revisions/files')
    selectedLayers.value=peers;activeLayer.value=peers[0]??null
    textSelection.value={mode:'objects',ids:peers.map(s=>s.id)};layerError.value=null
  }catch(e){clearLayers();layerError.value=(e as Error).message}
}
/** Revision is captured at gesture start or numeric focus, never refreshed for commit. */
export async function layerCommand(edit:LayerEdit,expectedRevision=activeLayer.value?.revision,states=selectedLayers.value):Promise<boolean>{
  const first=states[0];if(!first||!expectedRevision||layerBusy.value)return false
  layerBusy.value=true
  try{
    const response=await fetch('/@studio/layer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'geometry',no:first.no,id:first.id,ids:states.map(s=>s.id),geometryEdit:edit,expectedRevision,session:sourceSession()})}),r=await response.json()
    if(!response.ok)throw Error(r.error??'Layer transaction refused')
    const updated=await Promise.all(states.map(s=>read(s.no,s.id)))
    selectedLayers.value=updated;activeLayer.value=updated[0];layerError.value=null
    await sourceHistory.refresh();return true
  }catch(e){layerError.value=(e as Error).message;return false}
  finally{layerBusy.value=false}
}
export const sourceHistory={
  canUndo:shallowRef(false),canRedo:shallowRef(false),structuralHead:shallowRef(false),
  async refresh(){const response=await fetch(`/@studio/source-history?session=${sourceSession()}`);if(response.ok){const r=await response.json();this.canUndo.value=r.canUndo;this.canRedo.value=r.canRedo;this.structuralHead.value=r.undoKind==='structural'||r.redoKind==='structural'}},
  async command(action:'undo'|'redo'){
    // Resolve the actual latest history owner, including another source file/slide.
    const current=await fetch('/@studio/source-history?session='+sourceSession()),data=await current.json()
    const head=data[action+'Head'];if(!current.ok||!head){layerError.value='History owner unavailable';return}
    const response=await fetch('/@studio/source-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,no:head.no,session:sourceSession(),expectedRevision:head.revision})}),result=await response.json()
    if(!response.ok){layerError.value=result.error;return}
    if(result.ownerKind==='structural'){
      clearLayers();endStudioTextEdit();activeText.value=null;selection.value=null
    }else if(result.ownerKind==='layer'){
      endStudioTextEdit();activeText.value=null
      const host=layerHost(result.no,result.id);if(host){selection.value={el:host,no:result.no,range:null,kind:'component',tag:'StudioLayer',positioned:true,nested:false,label:`${result.document.kind} layer`};await inspectLayer(host,result.no)}
    }else{
      clearLayers()
      const host=slideElement(result.no)?.querySelector<HTMLElement>(`[data-studio-text-id="${CSS.escape(result.id)}"]`)
      if(host){selection.value={el:host,no:result.no,range:null,kind:'component',tag:'StudioText',positioned:true,nested:false,label:'StudioText'};await inspectStudioText(host,result.no);await refreshStudioText();if(result.selection)textSelection.value=result.selection}
    }
    await this.refresh()
  },undo(){return this.command('undo')},redo(){return this.command('redo')},
}
export async function structuralLayer(action:'delete'|'duplicate'){
  const state=activeLayer.value;if(!state)return
  try{
    const response=await fetch('/@studio/structural',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:{kind:'object',action,slideId:state.document.slideId,id:state.id},expectedRevision:state.revision,session:sourceSession()})})
    const result=await response.json();if(!response.ok)throw Error(result.error??'Structural transaction refused')
    clearLayers();selection.value=null;await sourceHistory.refresh()
  }catch(e){layerError.value=(e as Error).message}
}
/** Managed authoring input is captured before DeckVideo/SlideNavigation. */
export function installLayerKeys(){
  const keyboard=(e:KeyboardEvent)=>{
    if(!studioOpen.value||(!activeLayer.value&&!sourceHistory.structuralHead.value))return
    const typing=e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable="true"]')
    if(typing)return
    if((e.ctrlKey||e.metaKey)&&['z','y'].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation();void sourceHistory.command(e.key.toLowerCase()==='y'||e.shiftKey?'redo':'undo');return}
    if(!activeLayer.value)return
    if(e.key==='Escape'){e.preventDefault();clearLayers();selection.value=null;return}
    if(['Delete','Backspace'].includes(e.key)){e.preventDefault();e.stopImmediatePropagation();void structuralLayer('delete');return}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();e.stopImmediatePropagation();void structuralLayer('duplicate');return}
    if((e.ctrlKey||e.metaKey)&&['c','v','x'].includes(e.key.toLowerCase())){e.preventDefault();e.stopImmediatePropagation();layerError.value='Cross-deck clipboard semantics are unavailable';return}
    const step=e.shiftKey?10:1,delta:Record<string,[number,number]>={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}
    if(delta[e.key]&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();e.stopImmediatePropagation();void layerCommand({kind:'translate',dx:delta[e.key][0],dy:delta[e.key][1]})}
  }
  document.addEventListener('keydown',keyboard,true)
  return ()=>document.removeEventListener('keydown',keyboard,true)
}
