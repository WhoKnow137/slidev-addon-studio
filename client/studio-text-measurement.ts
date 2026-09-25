import type { Size } from '../shared/geometry'
import type { TextDocument } from '../shared/studiotext'
import { slideElement } from './dom'

export function studioTextHost(no: number, id: string): HTMLElement | null {
  return slideElement(no)?.querySelector<HTMLElement>(`[data-studio-text-id="${CSS.escape(id)}"]`) ?? null
}
export function readStudioTextMeasurement(host: HTMLElement): Size {
  const style = getComputedStyle(host)
  const width = Number.parseFloat(style.width)
  const height = Number.parseFloat(style.height)
  if (!(width > 0) || !(height > 0)) throw Error('Text box has no measurable rendered size')
  return { width, height }
}
const frame = (doc: TextDocument) => [doc.geometry.x, doc.geometry.y,
  doc.geometry.width ?? 'auto', doc.geometry.height ?? 'auto'].join(',')
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

/** Wait for font layout and the HMR rendering of the current source frame. */
export async function measureStudioText(no: number, doc: TextDocument): Promise<Size> {
  await document.fonts?.ready
  const deadline = performance.now() + 2500
  while (performance.now() < deadline) {
    await nextFrame()
    const host = studioTextHost(no, doc.id)
    if (!host || host.dataset.studioTextPos !== frame(doc) || host.dataset.resize !== doc.resizeMode
      || Number.parseFloat(host.style.fontSize) !== doc.defaults.fontSize) continue
    await nextFrame()
    return readStudioTextMeasurement(host)
  }
  throw Error('Current StudioText rendering is not ready for measurement')
}
