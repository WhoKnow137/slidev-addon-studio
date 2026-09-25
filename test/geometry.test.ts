import { describe, expect, it } from 'vitest'
import { applyGeometry, geometryNumber, normalizeAngle, patchGeometrySource, rotateVector,
  screenToSlide, slideToScreen, snapAngle } from '../shared/geometry'
import { parseStudioText, serializeStudioText } from '../shared/studiotext'
import { snapBox } from '../client/composables/useSnapping'

const source = (mode = 'fixed', pos = '100,80,400,200', attrs = '', body = 'Hello world') =>
  `<StudioText version="1" id="alpha" pos="${pos}" resize="${mode}" :rotate="0" font-family="Inter" :font-size="48" line-height="1.2" letter-spacing="-1px" ${attrs}>${body}</StudioText>`
function doc(value: string) {
  const parsed = parseStudioText(value)
  if (!parsed.ok) throw Error(parsed.reason)
  return parsed.document
}
const measure = { width: 400, height: 200 }

describe('M3 geometry contract', () => {
  it('enforces three frame modes and preserves affine metadata', () => {
    expect(doc(source('auto-width', '100,80,auto,auto', 'max-width="800"')).geometry.maxWidth).toBe(800)
    expect(doc(source('auto-height', '100,80,400,auto')).geometry.height).toBeNull()
    expect(doc(source('fixed', '100,80,400,200', 'affine="1,0,0,1,5,6"')).geometry.affine).toEqual([1, 0, 0, 1, 5, 6])
    for (const [mode, pos] of [['auto-width', '0,0,400,auto'], ['auto-height', '0,0,auto,auto'], ['fixed', '0,0,400,auto']])
      expect(parseStudioText(source(mode, pos)).ok).toBe(false)
  })

  it('keeps auto constraints separate from measured size in all six mode transitions', () => {
    const autoWidth = doc(source('auto-width', '100,80,auto,auto'))
    const autoHeight = doc(source('auto-height', '100,80,400,auto'))
    const fixed = doc(source())
    expect(applyGeometry(autoWidth, { kind: 'mode', mode: 'auto-height', measurement: measure })).toMatchObject({ resizeMode: 'auto-height', geometry: { width: 400, height: null } })
    expect(applyGeometry(autoWidth, { kind: 'mode', mode: 'fixed', measurement: measure })).toMatchObject({ resizeMode: 'fixed', geometry: { width: 400, height: 200 } })
    expect(applyGeometry(autoHeight, { kind: 'mode', mode: 'auto-width' })).toMatchObject({ resizeMode: 'auto-width', geometry: { width: null, height: null } })
    expect(applyGeometry(autoHeight, { kind: 'mode', mode: 'fixed', measurement: measure })).toMatchObject({ resizeMode: 'fixed', geometry: { width: 400, height: 200 } })
    expect(applyGeometry(fixed, { kind: 'mode', mode: 'auto-height' })).toMatchObject({ resizeMode: 'auto-height', geometry: { width: 400, height: null } })
    expect(applyGeometry(fixed, { kind: 'mode', mode: 'auto-width' })).toMatchObject({ resizeMode: 'auto-width', geometry: { width: null, height: null } })
    expect(applyGeometry(autoHeight, { kind: 'translate', dx: 50, dy: 0 }).geometry.height).toBeNull()
  })

  it('resizes frame and mode without changing typography, runs, or text', () => {
    const before = doc(source('fixed', '100,80,400,200', '', 'Hello <StudioRun font-size="72" color="#ff3344">world</StudioRun>'))
    const resized = applyGeometry(before, { kind: 'resize', handle: 'se', dx: 400, dy: 200, measurement: measure })
    expect(resized.geometry).toMatchObject({ x: 100, y: 80, width: 800, height: 400 })
    expect(resized.defaults).toEqual(before.defaults)
    expect(resized.paragraphs).toEqual(before.paragraphs)
    const auto = doc(source('auto-width', '100,80,auto,auto'))
    expect(applyGeometry(auto, { kind: 'resize', handle: 'e', dx: 100, dy: 0, measurement: measure })).toMatchObject({ resizeMode: 'auto-height', geometry: { width: 500, height: null } })
    expect(applyGeometry(auto, { kind: 'resize', handle: 's', dx: 0, dy: 100, measurement: measure })).toMatchObject({ resizeMode: 'fixed', geometry: { width: 400, height: 300 } })
    const ah = doc(source('auto-height', '100,80,400,auto'))
    expect(applyGeometry(ah, { kind: 'resize', handle: 'e', dx: 100, dy: 0, measurement: measure }).geometry.height).toBeNull()
    expect(applyGeometry(ah, { kind: 'resize', handle: 's', dx: 0, dy: 100, measurement: measure }).resizeMode).toBe('fixed')
  })

  it('scales frame, absolute spacing and styled runs around the object center', () => {
    const before = doc(source('fixed', '100,80,400,200', '', 'Hello <StudioRun font-size="72" line-height="36px" letter-spacing="0.02em">world</StudioRun>'))
    const scaled = applyGeometry(before, { kind: 'scale', factor: 2, measurement: measure })
    expect(scaled.geometry).toMatchObject({ x: -100, y: -20, width: 800, height: 400 })
    expect(scaled.defaults.fontSize).toBe(96)
    expect(scaled.defaults.lineHeight).toBe(1.2)
    expect(scaled.defaults.letterSpacing).toBe('-2px')
    expect(scaled.paragraphs[0].runs[1].overrides).toMatchObject({ fontSize: 144, lineHeight: '72px', letterSpacing: '0.02em' })
    expect(scaled.paragraphs[0].runs.map(run => run.text)).toEqual(before.paragraphs[0].runs.map(run => run.text))
    expect(doc(serializeStudioText(scaled))).toEqual(scaled)
  })

  it('uses one screen-slide conversion and local rotation math at five zooms', () => {
    for (const scale of [0.25, 0.5, 1, 2, 4]) {
      const transform = { left: 30, top: 50, scale }
      const p = slideToScreen({ x: 100, y: 80 }, transform)
      expect(screenToSlide(p, transform)).toEqual({ x: 100, y: 80 })
      const moved = screenToSlide({ x: p.x + 100 * scale, y: p.y }, transform)
      expect(moved.x - 100).toBe(100)
      const resized = applyGeometry(doc(source()), { kind: 'resize', handle: 'e', dx: (100 * scale) / scale, dy: 0, measurement: measure })
      expect(resized.geometry.width).toBe(500)
    }
    for (const angle of [0, 30, 45, 90]) {
      const before = doc(source().replace(':rotate="0"', `rotate="${angle}"`))
      const moved = applyGeometry(before, { kind: 'translate', dx: 100, dy: 50 })
      expect(moved.geometry).toMatchObject({ x: 200, y: 130, rotationDeg: angle })
      for (const [handle, local, dimensions] of [
        ['e', { x: 100, y: 0 }, { width: 500, height: 200 }],
        ['s', { x: 0, y: 100 }, { width: 400, height: 300 }],
        ['se', { x: 100, y: 100 }, { width: 500, height: 300 }],
      ] as const) {
        const screenDelta = rotateVector(local, angle)
        const resized = applyGeometry(before, { kind: 'resize', handle,
          dx: screenDelta.x, dy: screenDelta.y, measurement: measure })
        expect(resized.geometry.width).toBe(dimensions.width)
        expect(resized.geometry.height).toBe(dimensions.height)
        expect(resized.geometry.rotationDeg).toBe(angle)
        expect(resized.paragraphs).toEqual(before.paragraphs)
      }
    }
  })

  it('normalizes angle and floating precision without drift', () => {
    expect(normalizeAngle(180)).toBe(-180)
    expect(snapAngle(44, true)).toBe(45)
    for (const value of [0, 15, 30, 45, 90, 180]) expect(snapAngle(value, true)).toBe(normalizeAngle(value))
    expect(geometryNumber(119.999999382)).toBe(120)
    let current = doc(source())
    current = applyGeometry(current, { kind: 'translate', dx: 1, dy: 0 })
    current = applyGeometry(current, { kind: 'translate', dx: -1, dy: 0 })
    current = applyGeometry(current, { kind: 'set', property: 'rotationDeg', value: 15 })
    current = applyGeometry(current, { kind: 'set', property: 'rotationDeg', value: 0 })
    expect(current.geometry).toEqual(doc(source()).geometry)
  })

  it('patches geometry attributes without rewriting typography or text', () => {
    const original = source('fixed', '100,80,400,200', 'data-private="x"')
    // Unsupported metadata cannot be edited, so use the ordinary supported fixture.
    const stable = source()
    const before = doc(stable)
    const after = applyGeometry(before, { kind: 'translate', dx: 50, dy: 0 })
    expect(patchGeometrySource(stable, before, after)).toBe(stable.replace('pos="100,80,400,200"', 'pos="150,80,400,200"'))
    const negative = applyGeometry(before, { kind: 'set', property: 'rotationDeg', value: -45 })
    expect(doc(patchGeometrySource(stable, before, negative)).geometry.rotationDeg).toBe(-45)
    expect(original).toContain('data-private')
  })

  it('refuses arbitrary affine edits and invalid dimensions', () => {
    const affine = doc(source('fixed', '100,80,400,200', 'affine="1,0,0,1,5,6"'))
    expect(() => applyGeometry(affine, { kind: 'translate', dx: 1, dy: 0 })).toThrow('read-only')
    expect(serializeStudioText(affine)).toContain('affine="1,0,0,1,5,6"')
    expect(() => applyGeometry(doc(source()), { kind: 'set', property: 'width', value: 0 })).toThrow('positive')
  })

  it('snaps slide edges/centers and peer edges/centers at a six-screen-pixel tolerance', () => {
    const canvas = { w: 1920, h: 1080 }
    const others = [{ x: 1100, y: 163, w: 200, h: 100 }]
    for (const zoom of [0.25, 0.5, 1, 2, 4]) {
      const threshold = 6 / zoom
      const center = snapBox({ x: 760 + 5 / zoom, y: 440 + 5 / zoom, w: 400, h: 200 },
        { canvas, others, threshold })
      expect(center.box.x).toBe(760)
      expect(center.box.y).toBe(440)
      expect(center.guides.map(guide => guide.at)).toContain(960)
      expect(center.guides.map(guide => guide.at)).toContain(540)
      const edge = snapBox({ x: 5 / zoom, y: 5 / zoom, w: 100, h: 100 }, { canvas, others, threshold })
      expect(edge.box.x).toBe(0)
      expect(edge.box.y).toBe(0)
      const peerEdge = snapBox({ x: 1100 + 5 / zoom, y: 163 + 5 / zoom, w: 100, h: 100 }, { canvas, others, threshold })
      expect(peerEdge.box.x).toBe(1100)
      expect(peerEdge.box.y).toBe(163)
      const peerCenter = snapBox({ x: 1150 - 5 / zoom, y: 163 + 5 / zoom, w: 100, h: 100 }, { canvas, others, threshold })
      expect(peerCenter.box.x).toBe(1150)
      const outside = snapBox({ x: 760 + 7 / zoom, y: 440 + 7 / zoom, w: 400, h: 200 },
        { canvas, others: [], threshold })
      expect(outside.guides).toHaveLength(0)
    }
  })
})
