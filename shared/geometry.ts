import type { ResizeMode, TextDocument, TextGeometry } from './studiotext'
import { NodeTypes, parse } from '@vue/compiler-dom'

export interface Point { x: number, y: number }
export interface Size { width: number, height: number }
export interface CanvasTransform { left: number, top: number, scale: number }
export type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'se' | 'sw'
export type GeometryEdit =
  | { kind: 'set', property: 'x' | 'y' | 'width' | 'height' | 'rotationDeg', value: number, measurement?: Size }
  | { kind: 'translate', dx: number, dy: number }
  | { kind: 'resize', handle: Handle, dx: number, dy: number, measurement: Size }
  | { kind: 'frame', geometry: Pick<TextGeometry, 'x' | 'y' | 'width' | 'height' | 'rotationDeg'>, mode: ResizeMode }
  | { kind: 'mode', mode: ResizeMode, measurement?: Size }
  | { kind: 'scale', factor: number, measurement: Size }

/** Persist six decimal places, display two. Collapse near integers. */
export function geometryNumber(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > 1e9) throw Error('Invalid geometry number')
  const rounded = Math.round(value * 1e6) / 1e6
  return Math.abs(rounded - Math.round(rounded)) < 1e-4 ? Math.round(rounded) : rounded
}
export const geometryDisplay = (value: number) => String(Math.round(value * 100) / 100)
export function normalizeAngle(value: number): number {
  return geometryNumber(((value + 180) % 360 + 360) % 360 - 180)
}
export function screenToSlide(point: Point, t: CanvasTransform): Point {
  if (!(t.scale > 0)) throw Error('Invalid canvas scale')
  return { x: (point.x - t.left) / t.scale, y: (point.y - t.top) / t.scale }
}
export function slideToScreen(point: Point, t: CanvasTransform): Point {
  if (!(t.scale > 0)) throw Error('Invalid canvas scale')
  return { x: t.left + point.x * t.scale, y: t.top + point.y * t.scale }
}
export function rotateVector(point: Point, degrees: number): Point {
  const r = degrees * Math.PI / 180
  return { x: point.x * Math.cos(r) - point.y * Math.sin(r),
    y: point.x * Math.sin(r) + point.y * Math.cos(r) }
}
export const snapAngle = (value: number, shift: boolean) => normalizeAngle(shift ? Math.round(value / 15) * 15 : value)

function requireMeasurement(measurement: Size | undefined): Size {
  if (!measurement || !Number.isFinite(measurement.width) || !Number.isFinite(measurement.height)
    || measurement.width <= 0 || measurement.height <= 0) throw Error('Current rendered text measurement is required')
  return measurement
}
function finitePositive(value: number) {
  const result = geometryNumber(value)
  if (result <= 0) throw Error('Text frame dimension must be positive')
  return result
}
function copy(document: TextDocument): TextDocument { return structuredClone(document) }
function scaleDistance(value: number | string, factor: number): number | string {
  if (typeof value === 'number') return value // unitless line height or zero spacing
  const px = /^(-?(?:\d+)(?:\.\d+)?)px$/.exec(value)
  return px ? `${geometryNumber(Number(px[1]) * factor)}px` : value
}
function scaleStyles(document: TextDocument, factor: number) {
  const change = (style: Partial<TextDocument['defaults']>) => {
    if (style.fontSize !== undefined) style.fontSize = finitePositive(style.fontSize * factor)
    if (style.lineHeight !== undefined) style.lineHeight = scaleDistance(style.lineHeight, factor)
    if (style.letterSpacing !== undefined) style.letterSpacing = scaleDistance(style.letterSpacing, factor)
  }
  change(document.defaults)
  for (const paragraph of document.paragraphs) for (const run of paragraph.runs) change(run.overrides)
}
export function applyGeometry(document: TextDocument, edit: GeometryEdit): TextDocument {
  if (document.geometry.affine) throw Error('Arbitrary affine geometry is read-only')
  const next = copy(document)
  const g = next.geometry
  switch (edit.kind) {
    case 'set': {
      if (edit.property === 'rotationDeg') g.rotationDeg = normalizeAngle(edit.value)
      else if (edit.property === 'x' || edit.property === 'y') g[edit.property] = geometryNumber(edit.value)
      else if (edit.property === 'width') {
        g.width = finitePositive(edit.value)
        if (next.resizeMode === 'auto-width') next.resizeMode = 'auto-height'
      }
      else {
        g.height = finitePositive(edit.value)
        if (next.resizeMode !== 'fixed') {
          g.width ??= finitePositive(requireMeasurement(edit.measurement).width)
          next.resizeMode = 'fixed'
        }
      }
      break
    }
    case 'translate':
      g.x = geometryNumber(g.x + edit.dx)
      g.y = geometryNumber(g.y + edit.dy)
      break
    case 'frame': {
      const frame = edit.geometry
      g.x = geometryNumber(frame.x)
      g.y = geometryNumber(frame.y)
      g.rotationDeg = normalizeAngle(frame.rotationDeg)
      g.width = frame.width === null ? null : finitePositive(frame.width)
      g.height = frame.height === null ? null : finitePositive(frame.height)
      if (edit.mode === 'auto-width' && (g.width !== null || g.height !== null)
        || edit.mode === 'auto-height' && (g.width === null || g.height !== null)
        || edit.mode === 'fixed' && (g.width === null || g.height === null)) throw Error('Frame does not match resize mode')
      if (edit.mode !== 'auto-width') delete g.maxWidth
      next.resizeMode = edit.mode
      break
    }
    case 'mode': {
      if (edit.mode === next.resizeMode) return document
      if (edit.mode === 'auto-width') { g.width = null; g.height = null }
      else if (edit.mode === 'auto-height') {
        g.width ??= finitePositive(requireMeasurement(edit.measurement).width)
        g.height = null
      }
      else {
        const m = (g.width === null || g.height === null) ? requireMeasurement(edit.measurement) : null
        g.width ??= finitePositive(m!.width)
        g.height ??= finitePositive(m!.height)
      }
      if (edit.mode !== 'auto-width') delete g.maxWidth
      next.resizeMode = edit.mode
      break
    }
    case 'resize': {
      const m = requireMeasurement(edit.measurement)
      const width = g.width ?? m.width
      const height = g.height ?? m.height
      const delta = rotateVector({ x: edit.dx, y: edit.dy }, -g.rotationDeg)
      const left = edit.handle.includes('w') ? delta.x : 0
      const right = edit.handle.includes('e') ? delta.x : 0
      const top = edit.handle.includes('n') ? delta.y : 0
      const bottom = edit.handle.includes('s') ? delta.y : 0
      const newWidth = finitePositive(Math.max(1, width + right - left))
      const newHeight = finitePositive(Math.max(1, height + bottom - top))
      const centerShift = rotateVector({ x: (left + right) / 2, y: (top + bottom) / 2 }, g.rotationDeg)
      g.x = geometryNumber(g.x + width / 2 + centerShift.x - newWidth / 2)
      g.y = geometryNumber(g.y + height / 2 + centerShift.y - newHeight / 2)
      if (edit.handle.includes('e') || edit.handle.includes('w')) g.width = newWidth
      if (edit.handle.includes('n') || edit.handle.includes('s')) g.height = newHeight
      if (g.height !== null && g.width === null) g.width = finitePositive(width)
      next.resizeMode = g.height !== null ? 'fixed' : g.width !== null ? 'auto-height' : 'auto-width'
      break
    }
    case 'scale': {
      const factor = edit.factor
      if (!Number.isFinite(factor) || factor <= 0 || factor > 100) throw Error('Invalid scale factor')
      const m = requireMeasurement(edit.measurement)
      const width = g.width ?? m.width
      const height = g.height ?? m.height
      g.x = geometryNumber(g.x + width * (1 - factor) / 2)
      g.y = geometryNumber(g.y + height * (1 - factor) / 2)
      if (g.width !== null) g.width = finitePositive(g.width * factor)
      if (g.height !== null) g.height = finitePositive(g.height * factor)
      if (g.maxWidth !== undefined) g.maxWidth = finitePositive(g.maxWidth * factor)
      scaleStyles(next, factor)
      break
    }
  }
  return JSON.stringify(next) === JSON.stringify(document) ? document : next
}

/** For geometry-only edits, replace only the changed opening-tag attributes. */
export function patchGeometrySource(source: string, before: TextDocument, after: TextDocument): string {
  const root = parse(source)
  const element = root.children.find(node => node.type === NodeTypes.ELEMENT)
  if (!element || element.type !== NodeTypes.ELEMENT || element.tag !== 'StudioText') throw Error('Expected StudioText source')
  const b = before.geometry; const a = after.geometry
  const pos = (g: TextGeometry) => [g.x, g.y, g.width ?? 'auto', g.height ?? 'auto'].join(',')
  const changes: Record<string, string> = {}
  if (pos(a) !== pos(b)) changes.pos = pos(a)
  if (before.resizeMode !== after.resizeMode) changes.resize = after.resizeMode
  if (a.rotationDeg !== b.rotationDeg) changes.rotate = String(a.rotationDeg)
  if (a.maxWidth !== b.maxWidth) changes['max-width'] = a.maxWidth === undefined ? '' : String(a.maxWidth)
  if (!Object.keys(changes).length) return source
  const patches: { start: number, end: number, text: string }[] = []
  for (const prop of element.props) {
    const name = prop.type === NodeTypes.ATTRIBUTE ? prop.name : prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? prop.arg.content : ''
    if (Object.hasOwn(changes, name)) {
      patches.push({ start: prop.loc.start.offset, end: prop.loc.end.offset,
        text: changes[name] === '' ? '' : `${name}="${changes[name]}"` })
      delete changes[name]
    }
  }
  if (Object.keys(changes).length) {
    const startTag = element.loc.source
    let quote = ''
    let openEnd = -1
    for (let i = 0; i < startTag.length; i++) {
      const char = startTag[i]
      if (quote) { if (char === quote) quote = '' }
      else if (char === '"' || char === "'") quote = char
      else if (char === '>') { openEnd = i; break }
    }
    if (openEnd < 0) throw Error('StudioText start tag not found')
    patches.push({ start: element.loc.start.offset + openEnd, end: element.loc.start.offset + openEnd,
      text: Object.entries(changes).filter(([, value]) => value !== '').map(([key, value]) => ` ${key}="${value}"`).join('') })
  }
  return patches.sort((x, y) => y.start - x.start).reduce((text, patch) =>
    text.slice(0, patch.start) + patch.text + text.slice(patch.end), source)
}
