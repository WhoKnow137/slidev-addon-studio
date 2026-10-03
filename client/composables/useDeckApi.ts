import type { StudioAsset } from '../types'
import { busy, reportError } from '../state'
import { sourceSession } from '../source-session'

/**
 * The dev-only endpoints Studio adds on top of Slidev's own.
 *
 * Slidev can patch a slide, but not add, remove or reorder one, and it has no
 * notion of dropping a file into `public/`. These are served by the addon's
 * Vite plugin and rewrite the Markdown file directly; the file watcher then
 * pushes the result back to the browser like any other edit.
 */

const BASE = '/@studio/'

async function request<T>(route: string, init?: RequestInit): Promise<T | null> {
  busy.value = true
  try {
    const response = await fetch(BASE + route, init)
    const body = await response.json()
    if (!response.ok || body?.error)
      throw new Error(body?.error ?? `Request failed with ${response.status}`)
    return body as T
  }
  catch (error) {
    reportError(error)
    return null
  }
  finally {
    busy.value = false
  }
}

function post<T>(route: string, payload: unknown) {
  return request<T>(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function postDeck(payload: Record<string, unknown>) {
  const state=await request<{supported:boolean,revisions?:Record<string,string>}>('deck')
  if (!state) return null
  const result=await post<DeckResult>('deck',state.supported
    ? {...payload,session:sourceSession(),expectedRevision:state.revisions?.['slides.md']}
    : payload)
  if(result&&state.supported)void import('../managed-layer-editor').then(({sourceHistory})=>sourceHistory.refresh())
  return result
}

export interface DeckResult {
  ok: true
  no: number
  total: number
}

export const deckApi = {
  insert: (after: number, content?: string, frontmatter?: string) =>
    postDeck({ action: 'insert', after, content, frontmatter }),
  duplicate: (no: number) => postDeck({ action: 'duplicate', no }),
  remove: (no: number) => postDeck({ action: 'remove', no }),
  move: (no: number, to: number) => postDeck({ action: 'move', no, to }),
}

export const assetApi = {
  list: () => request<{ assets: StudioAsset[], root: string }>('assets'),
  upload: (name: string, data: string, dir?: string) => post<StudioAsset>('assets', { name, data, dir }),
}

/** Reads a dropped file as base64 for the upload endpoint. */
export function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
