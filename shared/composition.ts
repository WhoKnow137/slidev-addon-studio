import type { StudioSelection } from './studiotext'

/** Holds intermediate IME candidates outside the authoritative text document. */
export class TextCompositionBuffer {
  private current: { selection: StudioSelection, text: string } | null = null
  get active(): boolean { return this.current !== null }
  start(selection: StudioSelection): void { this.current = { selection: structuredClone(selection), text: '' } }
  update(text: string): void { if (this.current) this.current.text = text }
  finish(text: string): { selection: StudioSelection, text: string } | null {
    if (!this.current) return null
    const result = text ? { selection: this.current.selection, text } : null
    this.current = null
    return result
  }
  cancel(): void { this.current = null }
}
