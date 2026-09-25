import type { SourceHandle, TextDocument, TextPoint, StudioSelection } from '../shared/studiotext'
import type { TypographyEdit } from '../shared/typography'
import type { GeometryEdit } from '../shared/geometry'
import { shallowRef } from 'vue'
import { graphemes } from '../shared/studiotext'
import { slideElement } from './dom'
import { reportError } from './state'

interface ActiveText {
  id: string
  no: number
  handle: SourceHandle
  document: TextDocument | null
  reason: string | null
  revision: string
  canUndo: boolean
  canRedo: boolean
  stale: boolean
  editing: boolean
}
export const activeText = shallowRef<ActiveText | null>(null)
export const textSelection = shallowRef<StudioSelection>({ mode: 'objects', ids: [] })
export const textError = shallowRef<string | null>(null)
export const textBusy = shallowRef(false)
const sessionKey = 'slidev-studio:text-session'
function session(): string {
  let value = sessionStorage.getItem(sessionKey)
  if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(sessionKey, value) }
  return value
}
function root(): HTMLElement | null {
  const state = activeText.value
  return state ? slideElement(state.no)?.querySelector<HTMLElement>(`[data-studio-text-id="${CSS.escape(state.id)}"]`) ?? null : null
}
function paragraphs(host: HTMLElement): HTMLElement[] {
  const explicit = [...host.querySelectorAll<HTMLElement>('.studio-text-paragraph')]
  return explicit.length ? explicit : [host]
}
function domText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node instanceof HTMLBRElement) return '\n'
  return [...node.childNodes].map(domText).join('')
}
function pointFromDom(host: HTMLElement, node: Node, offset: number): TextPoint | null {
  const parts = paragraphs(host)
  const index = parts.findIndex(part => part === node || part.contains(node))
  if (index < 0) return null
  const paragraph = parts[index]
  try {
    const range = document.createRange()
    range.selectNodeContents(paragraph)
    range.setEnd(node, offset)
    const prefix = domText(range.cloneContents())
    return { paragraph: index, grapheme: graphemes(prefix).length }
  }
  catch { return null }
}
function endpoint(host: HTMLElement, at: TextPoint): { node: Node, offset: number } | null {
  const paragraph = paragraphs(host)[at.paragraph]
  if (!paragraph) return null
  let remaining = at.grapheme
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let current: Node | null = walker.nextNode()
  let last: { node: Node, offset: number } = { node: paragraph, offset: 0 }
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      const pieces = graphemes(current.textContent ?? '')
      if (remaining <= pieces.length) return { node: current, offset: pieces.slice(0, remaining).join('').length }
      remaining -= pieces.length
      last = { node: current, offset: current.textContent?.length ?? 0 }
    }
    else if (current instanceof HTMLBRElement) {
      if (remaining === 0) return { node: current.parentNode!, offset: [...current.parentNode!.childNodes].indexOf(current) }
      remaining -= 1
      last = { node: current.parentNode!, offset: [...current.parentNode!.childNodes].indexOf(current) + 1 }
    }
    current = walker.nextNode()
  }
  return remaining === 0 ? last : null
}
export function captureStudioTextSelection(): StudioSelection | null {
  const state = activeText.value
  const host = root()
  const selected = window.getSelection()
  if (!state || !host || !selected?.anchorNode || !selected.focusNode) return null
  if (!host.contains(selected.anchorNode) || !host.contains(selected.focusNode)) return null
  const anchor = pointFromDom(host, selected.anchorNode, selected.anchorOffset)
  const focus = pointFromDom(host, selected.focusNode, selected.focusOffset)
  if (!anchor || !focus) return null
  const logical: StudioSelection = anchor.paragraph === focus.paragraph && anchor.grapheme === focus.grapheme
    ? { mode: 'textCaret', textId: state.id, at: anchor,
        ...(textSelection.value.mode === 'textCaret' && textSelection.value.textId === state.id
          && textSelection.value.at.paragraph === anchor.paragraph && textSelection.value.at.grapheme === anchor.grapheme
          ? { typingStyle: textSelection.value.typingStyle } : {}) }
    : { mode: 'textRange', textId: state.id, anchor, focus }
  textSelection.value = logical
  return logical
}
export function restoreStudioTextSelection(): boolean {
  const state = activeText.value
  const host = root()
  const logical = textSelection.value
  if (!state || !host || logical.mode === 'objects' || logical.textId !== state.id) return false
  const anchor = endpoint(host, logical.mode === 'textCaret' ? logical.at : logical.anchor)
  const focus = endpoint(host, logical.mode === 'textCaret' ? logical.at : logical.focus)
  if (!anchor || !focus) return false
  const selection = window.getSelection()
  if (!selection) return false
  selection.removeAllRanges()
  const range = document.createRange()
  range.setStart(anchor.node, anchor.offset)
  range.collapse(true)
  selection.addRange(range)
  if (logical.mode === 'textRange') selection.extend(focus.node, focus.offset)
  return true
}

let loadGeneration = 0
async function loadStudioText(element: HTMLElement, no: number, editing: boolean) {
  const id = element.dataset.studioTextId
  if (!id) return
  if (!editing && activeText.value?.id === id && activeText.value.no === no) return
  endStudioTextEdit()
  const generation = ++loadGeneration
  textError.value = null
  try {
    const response = await fetch(`/@studio/text?no=${no}&id=${encodeURIComponent(id)}&session=${session()}`)
    const result = await response.json()
    if (generation !== loadGeneration) return
    if (!response.ok) {
      textError.value = result.error ?? `Source lookup failed (${response.status})`
      reportError(new Error(textError.value!))
      return
    }
    activeText.value = { id, no, handle: result.handle, document: result.document, reason: result.reason,
      revision: result.handle.expectedRevision, canUndo: result.canUndo, canRedo: result.canRedo, stale: false, editing }
    textSelection.value = { mode: 'objects', ids: [id] }
    if (result.editable && editing) {
      element.setAttribute('contenteditable', 'true')
      element.setAttribute('spellcheck', 'false')
      captureStudioTextSelection()
    }
    else if (!result.editable) textError.value = `Visual text editing unavailable: ${result.reason}`
  }
  catch (error) {
    textError.value = error instanceof Error ? error.message : String(error)
    reportError(error)
  }
}
export function inspectStudioText(element: HTMLElement, no: number) { return loadStudioText(element, no, false) }
export function beginStudioTextEdit(element: HTMLElement, no: number) { return loadStudioText(element, no, true) }
export function endStudioTextEdit() {
  loadGeneration++
  root()?.removeAttribute('contenteditable')
  activeText.value = null
  textSelection.value = { mode: 'objects', ids: [] }
}
async function sendTextCommand(action: 'format' | 'typography' | 'geometry' | 'geometry-batch' | 'undo' | 'redo',
  property?: 'color' | 'fontSize', value?: string | number, edit?: TypographyEdit, geometryEdit?: GeometryEdit) {
  const state = activeText.value
  if (!state || state.stale || !state.document || textBusy.value) return false
  if (action === 'format' && textSelection.value.mode !== 'textRange') { textError.value = 'Select a word or range first.'; return false }
  textBusy.value = true
  try {
    const response = await fetch('/@studio/text', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, no: state.no, id: state.id, session: session(), expectedRevision: state.revision,
        selection: textSelection.value, property, value, edit, geometryEdit,
        ids: textSelection.value.mode === 'objects' ? textSelection.value.ids : undefined }) })
    const result = await response.json()
    if (!response.ok) {
      textError.value = result.error ?? `Text edit failed (${response.status})`
      if (response.status === 409) activeText.value = { ...state, stale: true }
      return false
    }
    activeText.value = { ...state, revision: result.revision, document: result.document ?? state.document,
      canUndo: result.canUndo, canRedo: result.canRedo }
    if (result.selection) textSelection.value = result.selection
    textError.value = null
    // Slidev's watcher replaces the rendered component. Resolve it by stable ID,
    // then restore from model coordinates; never retain a DOM Range as state.
    setTimeout(() => restoreStudioTextSelection(), 160)
    return true
  }
  catch (error) { textError.value = error instanceof Error ? error.message : String(error); return false }
  finally { textBusy.value = false }
}
export function studioTextCommand(action: 'format' | 'undo' | 'redo', property?: 'color' | 'fontSize', value?: string | number) {
  return sendTextCommand(action, property, value)
}
export function studioTypographyCommand(edit: TypographyEdit) {
  return sendTextCommand('typography', undefined, undefined, edit)
}
export function studioGeometryCommand(edit: GeometryEdit) {
  return sendTextCommand('geometry', undefined, undefined, undefined, edit)
}
export function studioGeometryBatchCommand(edit: GeometryEdit) {
  return sendTextCommand('geometry-batch', undefined, undefined, undefined, edit)
}

export function installStudioTextSelection() {
  const onSelection = () => { if (activeText.value) captureStudioTextSelection() }
  const preventMutation = (event: Event) => {
    const host = root()
    if (host && event.target instanceof Node && host.contains(event.target)) event.preventDefault()
  }
  const keyboard = (event: KeyboardEvent) => {
    if (!activeText.value || !(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'z' || key === 'y') {
      event.preventDefault()
      void studioTextCommand(key === 'y' || event.shiftKey ? 'redo' : 'undo')
    }
  }
  const observer = new MutationObserver(() => {
    const state = activeText.value
    const host = root()
    if (state?.editing && host && !host.isContentEditable && state.document) {
      host.setAttribute('contenteditable', 'true')
      host.setAttribute('spellcheck', 'false')
      restoreStudioTextSelection()
    }
  })
  document.addEventListener('selectionchange', onSelection)
  document.addEventListener('beforeinput', preventMutation, true)
  document.addEventListener('keydown', keyboard, true)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    document.removeEventListener('selectionchange', onSelection)
    document.removeEventListener('beforeinput', preventMutation, true)
    document.removeEventListener('keydown', keyboard, true)
    observer.disconnect()
  }
}
