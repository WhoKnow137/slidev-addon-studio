import type { StudioTextStyle, StudioTextStyleFile } from '../shared/text-styles'
import { shallowRef } from 'vue'

export const textStyleState = shallowRef<{ file: StudioTextStyleFile, revision: string,
  canUndo: boolean, canRedo: boolean }>({ file: { version: 1, styles: [] }, revision: '', canUndo: false, canRedo: false })
export const textStyleError = shallowRef<string | null>(null)
const sessionKey = 'slidev-studio:style-session'
function session(): string {
  let value = sessionStorage.getItem(sessionKey)
  if (!value) { value = crypto.randomUUID(); sessionStorage.setItem(sessionKey, value) }
  return value
}
export async function loadTextStyles() {
  try {
    const response = await fetch(`/@studio/text-styles?session=${session()}`)
    const result = await response.json()
    if (!response.ok) throw Error(result.error ?? 'Text styles unavailable')
    textStyleState.value = result
    textStyleError.value = null
  }
  catch (error) { textStyleError.value = error instanceof Error ? error.message : String(error) }
}
export async function textStyleCommand(action: 'upsert' | 'undo' | 'redo', style?: StudioTextStyle): Promise<boolean> {
  try {
    const response = await fetch('/@studio/text-styles', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, style, session: session(), expectedRevision: textStyleState.value.revision }) })
    const result = await response.json()
    if (!response.ok) throw Error(result.error ?? 'Style transaction failed')
    textStyleState.value = result
    textStyleError.value = null
    return true
  }
  catch (error) { textStyleError.value = error instanceof Error ? error.message : String(error); return false }
}
