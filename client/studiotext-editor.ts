import type { SourceHandle, TextDocument, TextPoint, StudioSelection } from '../shared/studiotext'
import type { TypographyEdit } from '../shared/typography'
import type { GeometryEdit } from '../shared/geometry'
import { shallowRef } from 'vue'
import { graphemes, orderedRange } from '../shared/studiotext'
import { replaceText } from '../shared/text-content'
import { TextCompositionBuffer } from '../shared/composition'
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

/** Temporary DOM-only typography preview. The source model and history stay untouched. */
export function previewStudioTextRange(property: 'fontFamily' | 'fontVariationSettings', value: string): (() => void) | null {
  const host = root()
  const logical = textSelection.value
  if (!host || logical.mode !== 'textRange' || logical.textId !== activeText.value?.id) return null
  const [lo, hi] = orderedRange(logical)
  const start = endpoint(host, lo), end = endpoint(host, hi)
  if (!start || !end) return null
  const range = document.createRange()
  range.setStart(start.node, start.offset)
  range.setEnd(end.node, end.offset)
  const segments: { original: Text, before: string, lo: number, hi: number }[] = []
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node instanceof Text) || !range.intersectsNode(node)) continue
    const first = node === start.node ? start.offset : 0
    const last = node === end.node ? end.offset : node.length
    if (last > first) segments.push({ original: node, before: node.textContent ?? '', lo: first, hi: last })
  }
  if (!segments.length) return null
  const wrappers: { original: Text, before: string, lo: number, after: Text | null, wrapper: HTMLSpanElement }[] = []
  for (const segment of segments.reverse()) {
    const { original, before, lo: from, hi: to } = segment
    const selected = from ? original.splitText(from) : original
    const after = to - from < selected.length ? selected.splitText(to - from) : null
    const wrapper = document.createElement('span')
    wrapper.dataset.studioTextPreview = ''
    if (property === 'fontVariationSettings') {
      const inherited = getComputedStyle(selected.parentElement!).fontVariationSettings
      const settings = new Map([...inherited.matchAll(/"([A-Za-z0-9]{4})"\s+(-?[\d.]+)/g)].map(match => [match[1], match[2]]))
      for (const match of value.matchAll(/"([A-Za-z0-9]{4})"\s+(-?[\d.]+)/g)) settings.set(match[1], match[2])
      wrapper.style.fontVariationSettings = [...settings].sort(([a], [b]) => a.localeCompare(b)).map(([tag, number]) => `"${tag}" ${number}`).join(', ')
    }
    else wrapper.style[property] = value
    selected.parentNode!.insertBefore(wrapper, selected)
    wrapper.appendChild(selected)
    wrappers.push({ original, before, lo: from, after, wrapper })
  }
  restoreStudioTextSelection()
  return () => {
    for (const { original, before, lo: from, after, wrapper } of wrappers.reverse()) {
      if (!wrapper.isConnected) continue
      if (from) { original.textContent = before; wrapper.remove() }
      else { wrapper.replaceWith(original); original.textContent = before }
      after?.remove()
    }
    restoreStudioTextSelection()
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
async function sendTextCommand(action: 'format' | 'typography' | 'geometry' | 'geometry-batch' | 'style' | 'content' | 'undo' | 'redo',
  property?: 'color' | 'fontSize', value?: string | number, edit?: TypographyEdit, geometryEdit?: GeometryEdit,
  styleEdit?: { kind: 'apply', id: string } | { kind: 'detach' }, content?: string, selected?: StudioSelection) {
  const state = activeText.value
  if (!state || state.stale || !state.document || textBusy.value) return false
  if (action === 'format' && textSelection.value.mode !== 'textRange') { textError.value = 'Select a word or range first.'; return false }
  textBusy.value = true
  try {
    const response = await fetch('/@studio/text', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, no: state.no, id: state.id, session: session(), expectedRevision: state.revision,
        selection: selected ?? textSelection.value, property, value, edit, geometryEdit, styleEdit, content,
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
/** Guard a continuous preview against the revision at gesture start. */
export async function commitTypographyPreview(edit: TypographyEdit, id: string, revision: string, selection: StudioSelection) {
  const state = activeText.value
  if (!state || state.id !== id || state.revision !== revision || JSON.stringify(textSelection.value) !== JSON.stringify(selection)) {
    textError.value = 'Text or selection changed during preview. Reload before editing.'
    return false
  }
  // sendTextCommand transmits the captured revision; disk changes are also refused by the service.
  return sendTextCommand('typography', undefined, undefined, edit, undefined, undefined, undefined, selection)
}
export function studioStyleCommand(styleEdit: { kind: 'apply', id: string } | { kind: 'detach' }) {
  return sendTextCommand('style', undefined, undefined, undefined, undefined, styleEdit)
}
export function studioContentCommand(content: string, selection: StudioSelection) {
  return sendTextCommand('content', undefined, undefined, undefined, undefined, undefined, content, selection)
}
export async function refreshStudioText() {
  const state = activeText.value
  if (!state) return
  try {
    const response = await fetch(`/@studio/text?no=${state.no}&id=${encodeURIComponent(state.id)}&session=${session()}`)
    const result = await response.json()
    if (!response.ok) throw Error(result.error ?? 'Text refresh failed')
    activeText.value = { ...state, document: result.document, reason: result.reason,
      handle: result.handle, revision: result.handle.expectedRevision,
      canUndo: result.canUndo, canRedo: result.canRedo }
  }
  catch (error) { textError.value = error instanceof Error ? error.message : String(error) }
}
export function studioGeometryCommand(edit: GeometryEdit) {
  return sendTextCommand('geometry', undefined, undefined, undefined, edit)
}
export function studioGeometryBatchCommand(edit: GeometryEdit) {
  return sendTextCommand('geometry-batch', undefined, undefined, undefined, edit)
}

export function installStudioTextSelection() {
  const composing = new TextCompositionBuffer()
  let suppressCompositionInput = false
  let pendingDocument: TextDocument | null = null
  let pendingSelection: StudioSelection | null = null
  let pendingCount = 0
  let contentTail: Promise<unknown> = Promise.resolve()
  const onSelection = () => { if (activeText.value?.editing && !composing.active && !pendingCount) captureStudioTextSelection() }
  const queueContent = (content: string, selected?: StudioSelection) => {
    const state = activeText.value
    if (!state?.document) return
    const selection = selected ?? pendingSelection ?? captureStudioTextSelection() ?? textSelection.value
    if (selection.mode === 'objects') return
    try {
      const preview = replaceText(pendingDocument ?? state.document, selection, content)
      pendingDocument = preview.document
      pendingSelection = preview.selection
      pendingCount++
      contentTail = contentTail.then(() => studioContentCommand(content, selection)).finally(() => {
        pendingCount--
        if (!pendingCount) { pendingDocument = null; pendingSelection = null }
      })
    }
    catch (error) { textError.value = error instanceof Error ? error.message : String(error) }
  }
  const beforeInput = (event: Event) => {
    const host = root()
    if (!host || !(event.target instanceof Node) || !host.contains(event.target)) return
    const input = event as InputEvent
    if (composing.active || input.isComposing) return
    event.preventDefault()
    if (suppressCompositionInput && ['insertText', 'insertFromComposition'].includes(input.inputType)) {
      suppressCompositionInput = false; return
    }
    if (input.inputType === 'insertText' || input.inputType === 'insertLineBreak')
      queueContent(input.inputType === 'insertLineBreak' ? '\n' : input.data ?? '')
    else if (input.inputType === 'insertFromPaste')
      queueContent((input.dataTransfer?.getData('text/plain') ?? input.data ?? '').replaceAll('\r\n', '\n'))
    else if (input.inputType === 'deleteContentBackward' || input.inputType === 'deleteContentForward') {
      const state = activeText.value
      const selection = pendingSelection ?? captureStudioTextSelection() ?? textSelection.value
      if (!state?.document || selection.mode === 'objects') return
      if (selection.mode === 'textRange') { queueContent('', selection); return }
      const at = selection.at
      let anchor: TextPoint = at
      let focus: TextPoint = at
      const current = pendingDocument ?? state.document
      if (input.inputType === 'deleteContentBackward') {
        if (at.grapheme > 0) anchor = { ...at, grapheme: at.grapheme - 1 }
        else if (at.paragraph > 0) anchor = { paragraph: at.paragraph - 1,
          grapheme: graphemes(current.paragraphs[at.paragraph - 1].runs.map(run => run.text).join('')).length }
      }
      else {
        const length = graphemes(current.paragraphs[at.paragraph].runs.map(run => run.text).join('')).length
        if (at.grapheme < length) focus = { ...at, grapheme: at.grapheme + 1 }
        else if (at.paragraph < current.paragraphs.length - 1) focus = { paragraph: at.paragraph + 1, grapheme: 0 }
      }
      if (anchor !== at || focus !== at) queueContent('', { mode: 'textRange', textId: state.id, anchor, focus })
    }
  }
  const onCompositionStart = (event: CompositionEvent) => {
    const host = root()
    if (!host || !(event.target instanceof Node) || !host.contains(event.target)) return
    composing.start(pendingSelection ?? captureStudioTextSelection() ?? textSelection.value)
  }
  const onCompositionUpdate = (event: CompositionEvent) => { composing.update(event.data) }
  const onCompositionEnd = (event: CompositionEvent) => {
    const final = composing.finish(event.data)
    if (!final) return
    suppressCompositionInput = true
    setTimeout(() => { suppressCompositionInput = false }, 0)
    queueContent(final.text, final.selection)
  }
  const keyboard = (event: KeyboardEvent) => {
    if (!activeText.value || !(event.ctrlKey || event.metaKey) || event.altKey) return
    const key = event.key.toLowerCase()
    if (key === 'z' || key === 'y') {
      event.preventDefault()
      void import('./managed-layer-editor').then(({sourceHistory})=>sourceHistory.command(key === 'y' || event.shiftKey ? 'redo' : 'undo'))
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
  document.addEventListener('beforeinput', beforeInput, true)
  document.addEventListener('compositionstart', onCompositionStart, true)
  document.addEventListener('compositionupdate', onCompositionUpdate, true)
  document.addEventListener('compositionend', onCompositionEnd, true)
  document.addEventListener('keydown', keyboard, true)
  // Vue can patch attributes in place without replacing children. Preserve edit
  // mode when such a patch removes our transient contenteditable attribute.
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] })
  return () => {
    document.removeEventListener('selectionchange', onSelection)
    document.removeEventListener('beforeinput', beforeInput, true)
    document.removeEventListener('compositionstart', onCompositionStart, true)
    document.removeEventListener('compositionupdate', onCompositionUpdate, true)
    document.removeEventListener('compositionend', onCompositionEnd, true)
    document.removeEventListener('keydown', keyboard, true)
    observer.disconnect()
  }
}
