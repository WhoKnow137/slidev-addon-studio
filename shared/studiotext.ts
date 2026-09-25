import { NodeTypes, parse } from '@vue/compiler-dom'
import type { AttributeNode, DirectiveNode, ElementNode, SimpleExpressionNode, TemplateChildNode } from '@vue/compiler-dom'

export type ResizeMode = 'auto-width' | 'auto-height' | 'fixed'
export interface TextPoint { paragraph: number, grapheme: number }
export interface CharacterStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: 'normal' | 'italic' | 'oblique'
  color: string
  lineHeight: number | string
  letterSpacing: number | string
  decoration: 'none' | 'underline' | 'line-through' | 'underline line-through'
  textCase: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  link?: string
  fontAxes?: Record<string, number>
  openType?: Record<string, boolean | number>
}
export interface ParagraphStyle {
  align?: 'left' | 'center' | 'right' | 'justify'
  spacingBefore?: number
  spacingAfter?: number
  indent?: number
  list?: { kind: 'ordered' | 'bullet', level: number }
}
export interface TextRun { text: string, overrides: Partial<CharacterStyle> }
export interface TextParagraph { properties: ParagraphStyle, runs: TextRun[] }
export interface TextGeometry {
  x: number
  y: number
  width: number | null
  height: number | null
  maxWidth?: number
  rotationDeg: number
  affine?: [number, number, number, number, number, number]
}
export interface TextDocument {
  version: 1
  id: string
  paragraphs: TextParagraph[]
  defaults: CharacterStyle
  geometry: TextGeometry
  resizeMode: ResizeMode
  verticalAlign: 'top' | 'center' | 'bottom'
  /** Object-level paragraph alignment, separate from paragraph overrides. */
  align: 'left' | 'center' | 'right' | 'justify'
  styleRef?: string
}
export type StudioSelection =
  | { mode: 'objects', ids: string[] }
  | { mode: 'textCaret', textId: string, at: TextPoint, typingStyle?: Partial<CharacterStyle> }
  | { mode: 'textRange', textId: string, anchor: TextPoint, focus: TextPoint }
export interface SourceSpan { id: string, start: number, end: number, source: string }
export interface SourceHandle {
  fileId: string
  filePath: string
  textId: string
  sourceStart: number
  sourceEnd: number
  expectedRevision: string
}
export type ParseResult = { ok: true, document: TextDocument } | { ok: false, reason: string }

const textAttrs = new Set(['version', 'id', 'pos', 'resize', 'rotate', 'max-width', 'affine', 'font-family', 'font-size', 'font-weight', 'font-style', 'color', 'line-height', 'letter-spacing', 'decoration', 'text-case', 'align', 'vertical-align', 'style-ref'])
const runAttrs = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'line-height', 'letter-spacing', 'decoration', 'text-case', 'link'])
const paragraphAttrs = new Set(['align'])
const numericAttrs = new Set(['rotate', 'font-size', 'font-weight', 'letter-spacing'])
const defaultStyle: CharacterStyle = {
  fontFamily: 'sans-serif', fontSize: 32, fontWeight: 400, fontStyle: 'normal', color: '#ffffff',
  lineHeight: 'normal', letterSpacing: 0, decoration: 'none', textCase: 'none',
}
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export function graphemes(text: string): string[] { return [...segmenter.segment(text)].map(part => part.segment) }
const count = (text: string) => graphemes(text).length
const fail = (reason: string): never => { throw new Error(reason) }

function attrs(node: ElementNode, allowed: Set<string>): Record<string, string | number> {
  const values: Record<string, string | number> = {}
  for (const prop of node.props) {
    let name: string
    let value: string | number
    if (prop.type === NodeTypes.ATTRIBUTE) {
      const attr = prop as AttributeNode
      name = attr.name
      if (!attr.value) fail(`Attribute ${name} requires a literal value`)
      value = attr.value!.content
    }
    else {
      const directive = prop as DirectiveNode
      if (directive.name !== 'bind' || !directive.arg || directive.arg.type !== NodeTypes.SIMPLE_EXPRESSION || !directive.arg.isStatic || !directive.exp || directive.exp.type !== NodeTypes.SIMPLE_EXPRESSION)
        fail(`Unsupported directive or expression: ${prop.loc.source}`)
      name = (directive.arg as SimpleExpressionNode).content
      if (!numericAttrs.has(name) || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test((directive.exp as SimpleExpressionNode).content.trim()))
        fail(`Unsupported dynamic expression: ${prop.loc.source}`)
      value = Number((directive.exp as SimpleExpressionNode).content.trim())
    }
    if (!allowed.has(name)) fail(`Unsupported ${node.tag} attribute: ${name}`)
    if (Object.hasOwn(values, name)) fail(`Duplicate ${node.tag} attribute: ${name}`)
    values[name] = value
  }
  return values
}

function number(value: string | number | undefined, label: string, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) fail(`Invalid ${label}`)
  return parsed
}
function string(value: string | number | undefined, fallback: string): string {
  return value === undefined ? fallback : String(value)
}
export type EditableCharacterProperty = 'fontFamily' | 'fontWeight' | 'fontStyle' | 'fontSize' | 'color' | 'lineHeight' | 'letterSpacing' | 'decoration' | 'textCase'
export function validateCharacterValue(property: EditableCharacterProperty, input: unknown): CharacterStyle[EditableCharacterProperty] {
  const raw = String(input)
  switch (property) {
    case 'fontFamily':
      if (!raw.trim() || raw.length > 256 || /[\r\n\u0000-\u001f]/.test(raw)) fail('Invalid font family')
      return raw
    case 'fontWeight':
      if (typeof input !== 'number' && !/^(?:\d+)(?:\.\d+)?$/.test(raw)) fail('Invalid font weight')
      if (!Number.isFinite(Number(input)) || Number(input) < 1 || Number(input) > 1000) fail('Invalid font weight')
      return Number(input)
    case 'fontSize':
      if (!Number.isFinite(Number(input)) || Number(input) <= 0) fail('Invalid font size')
      return Number(input)
    case 'fontStyle':
      if (!['normal', 'italic', 'oblique'].includes(raw)) fail('Invalid font style')
      return raw as CharacterStyle['fontStyle']
    case 'color':
      if (!/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/.test(raw)) fail('Invalid color')
      return raw.toLowerCase()
    case 'lineHeight':
      if (raw === 'normal') return 'normal'
      if (/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return Number(raw)
      if (/^(?:0|[1-9]\d*)(?:\.\d+)?(?:px|%)$/.test(raw)) return raw
      fail('Invalid line height')
    case 'letterSpacing':
      if (raw === '0') return 0
      if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:px|em)$/.test(raw)) return raw
      fail('Invalid letter spacing')
    case 'decoration':
      if (!['none', 'underline', 'line-through', 'underline line-through'].includes(raw)) fail('Invalid decoration')
      return raw as CharacterStyle['decoration']
    case 'textCase':
      if (!['none', 'uppercase', 'lowercase', 'capitalize'].includes(raw)) fail('Invalid text case')
      return raw as CharacterStyle['textCase']
  }
}
function styleAttrs(values: Record<string, string | number>): Partial<CharacterStyle> {
  const style: Partial<CharacterStyle> = {}
  if (values['font-family'] !== undefined) style.fontFamily = validateCharacterValue('fontFamily', values['font-family']) as string
  if (values['font-size'] !== undefined) style.fontSize = validateCharacterValue('fontSize', values['font-size']) as number
  if (values['font-weight'] !== undefined) style.fontWeight = validateCharacterValue('fontWeight', values['font-weight']) as number
  if (values['font-style'] !== undefined) {
    const value = String(values['font-style'])
    if (!['normal', 'italic', 'oblique'].includes(value)) fail('Invalid font-style')
    style.fontStyle = value as CharacterStyle['fontStyle']
  }
  if (values.color !== undefined) style.color = validateCharacterValue('color', values.color) as string
  if (values['line-height'] !== undefined) {
    const raw = String(values['line-height'])
    style.lineHeight = validateCharacterValue('lineHeight', raw) as CharacterStyle['lineHeight']
  }
  if (values['letter-spacing'] !== undefined) {
    const raw = String(values['letter-spacing'])
    style.letterSpacing = validateCharacterValue('letterSpacing', raw) as CharacterStyle['letterSpacing']
  }
  if (values.decoration !== undefined) style.decoration = validateCharacterValue('decoration', values.decoration) as CharacterStyle['decoration']
  if (values['text-case'] !== undefined) style.textCase = validateCharacterValue('textCase', values['text-case']) as CharacterStyle['textCase']
  if (values.link !== undefined) style.link = String(values.link)
  return style
}

function content(children: TemplateChildNode[], allowParagraph: boolean): TextRun[] {
  const runs: TextRun[] = []
  const append = (text: string, overrides: Partial<CharacterStyle> = {}) => {
    if (text) runs.push({ text, overrides })
  }
  for (const child of children) {
    if (child.type === NodeTypes.TEXT) { append(child.content); continue }
    if (child.type === NodeTypes.INTERPOLATION) fail('Vue interpolation is read-only')
    if (child.type === NodeTypes.COMMENT) fail('Comments inside StudioText are read-only')
    if (child.type !== NodeTypes.ELEMENT) fail('Unsupported text child')
    const element = child as ElementNode
    if (element.tag === 'br' && element.isSelfClosing && element.props.length === 0) { append('\n'); continue }
    if (element.tag === 'StudioRun' && !allowParagraph) {
      const overrides = styleAttrs(attrs(element, runAttrs))
      for (const run of content(element.children, true)) {
        if (Object.keys(run.overrides).length) fail('Nested StudioRun is read-only')
        append(run.text, overrides)
      }
      continue
    }
    fail(`Unsupported nested element: <${element.tag}>`)
  }
  return runs
}

export function parseStudioText(source: string): ParseResult {
  try {
    const errors: string[] = []
    const root = parse(source, { comments: true, whitespace: 'preserve', onError: error => errors.push(error.message) })
    if (errors.length) fail(`Invalid Vue markup: ${errors[0]}`)
    const nodes = root.children.filter(node => node.type !== NodeTypes.TEXT || node.content.trim())
    if (nodes.length !== 1 || nodes[0].type !== NodeTypes.ELEMENT || nodes[0].tag !== 'StudioText') fail('Expected exactly one StudioText element')
    const element = nodes[0] as ElementNode
    if (element.isSelfClosing) fail('StudioText cannot be self-closing')
    const values = attrs(element, textAttrs)
    if (values.version !== '1') fail('Unsupported StudioText version')
    if (typeof values.id !== 'string' || !values.id.trim()) fail('StudioText requires a literal stable ID')
    if (typeof values.pos !== 'string') fail('StudioText requires pos')
    const coords = String(values.pos).split(',')
    if (coords.length !== 4) fail('Invalid pos')
    const parseCoord = (value: string, allowAuto: boolean) => value === 'auto' && allowAuto ? null : number(value, 'pos', Number.NaN)
    const [x, y, width, height] = [parseCoord(coords[0], false), parseCoord(coords[1], false), parseCoord(coords[2], true), parseCoord(coords[3], true)]
    if (x === null || y === null || [x, y, width, height].some(value => value !== null && !Number.isFinite(value))) fail('Invalid pos')
    const resize = values.resize
    if (!['auto-width', 'auto-height', 'fixed'].includes(String(resize))) fail('Invalid resize mode')
    if (resize === 'auto-width' && (width !== null || height !== null)) fail('Auto Width requires auto width and height')
    if (resize === 'auto-height' && (width === null || width <= 0 || height !== null)) fail('Auto Height requires fixed width and auto height')
    if (resize === 'fixed' && (width === null || width <= 0 || height === null || height <= 0)) fail('Fixed Size requires positive width and height')
    const maxWidth = values['max-width'] === undefined ? undefined : number(values['max-width'], 'max-width', Number.NaN)
    if (maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0 || resize !== 'auto-width')) fail('Invalid max-width')
    const affineParts = values.affine === undefined ? undefined : String(values.affine).split(',').map(Number)
    if (affineParts && (affineParts.length !== 6 || affineParts.some(value => !Number.isFinite(value)))) fail('Invalid affine')
    const align = string(values.align, 'left')
    if (!['left', 'center', 'right', 'justify'].includes(align)) fail('Invalid align')
    const verticalAlign = string(values['vertical-align'], 'top')
    if (!['top', 'center', 'bottom'].includes(verticalAlign)) fail('Invalid vertical-align')
    const paragraphs: TextParagraph[] = []
    const explicit = element.children.some(child => child.type === NodeTypes.ELEMENT && child.tag === 'StudioParagraph')
    if (explicit) {
      for (const child of element.children) {
        if (child.type === NodeTypes.TEXT && !child.content.trim()) continue
        if (child.type !== NodeTypes.ELEMENT || child.tag !== 'StudioParagraph') fail('Mixed direct text and paragraphs are read-only')
        const paragraph = child as ElementNode
        const props = attrs(paragraph, paragraphAttrs)
        const paragraphAlign = string(props.align, 'left')
        if (!['left', 'center', 'right', 'justify'].includes(paragraphAlign)) fail('Invalid paragraph align')
        paragraphs.push({ properties: props.align === undefined ? {} : { align: paragraphAlign as ParagraphStyle['align'] },
          runs: content(paragraph.children, false) })
      }
    }
    else paragraphs.push({ properties: {}, runs: content(element.children, false) })
    const document: TextDocument = {
      version: 1, id: String(values.id),
      paragraphs, defaults: { ...defaultStyle, ...styleAttrs(values) },
      geometry: { x: x as number, y: y as number, width, height, rotationDeg: number(values.rotate, 'rotate', 0),
        ...(maxWidth === undefined ? {} : { maxWidth }),
        ...(affineParts === undefined ? {} : { affine: affineParts as TextGeometry['affine'] }) },
      resizeMode: resize as ResizeMode,
      verticalAlign: verticalAlign as TextDocument['verticalAlign'],
      align: align as TextDocument['align'],
      ...(values['style-ref'] !== undefined ? { styleRef: String(values['style-ref']) } : {}),
    }
    return { ok: true, document }
  }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
}

export function normalizeText(document: TextDocument): TextDocument {
  const copy = structuredClone(document)
  for (const paragraph of copy.paragraphs) {
    const merged: TextRun[] = []
    for (const run of paragraph.runs) {
      if (!run.text) continue
      for (const key of Object.keys(run.overrides) as (keyof CharacterStyle)[]) {
        if (run.overrides[key] === copy.defaults[key]) delete run.overrides[key]
      }
      const last = merged.at(-1)
      const same = last && JSON.stringify(Object.entries(last.overrides).sort()) === JSON.stringify(Object.entries(run.overrides).sort())
      if (same && last) last.text += run.text
      else merged.push(run)
    }
    paragraph.runs = merged
  }
  return copy
}

export function orderedRange(range: { anchor: TextPoint, focus: TextPoint }): [TextPoint, TextPoint] {
  const compare = range.anchor.paragraph - range.focus.paragraph || range.anchor.grapheme - range.focus.grapheme
  return compare <= 0 ? [range.anchor, range.focus] : [range.focus, range.anchor]
}
export function setCharacterProperties(document: TextDocument, range: { anchor: TextPoint, focus: TextPoint },
  input: Partial<Pick<CharacterStyle, EditableCharacterProperty>>): TextDocument {
  const patch: Partial<CharacterStyle> = {}
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (!['fontFamily', 'fontWeight', 'fontStyle', 'fontSize', 'color', 'lineHeight', 'letterSpacing', 'decoration', 'textCase'].includes(key))
      fail(`Unsupported character property: ${key}`)
    ;(patch as any)[key] = validateCharacterValue(key as EditableCharacterProperty, value)
  }
  if (!Object.keys(patch).length) return document
  return mapCharacterRange(document, range, () => patch)
}

/** One grapheme-safe split/merge engine for every character command. */
export function mapCharacterRange(document: TextDocument, range: { anchor: TextPoint, focus: TextPoint },
  change: (effective: CharacterStyle) => Partial<CharacterStyle>): TextDocument {
  const [start, end] = orderedRange(range)
  const copy = structuredClone(document)
  if (start.paragraph < 0 || end.paragraph >= copy.paragraphs.length) fail('Range outside document')
  let changed = false
  for (let p = start.paragraph; p <= end.paragraph; p++) {
    const paragraph = copy.paragraphs[p]
    const length = paragraph.runs.reduce((n, run) => n + count(run.text), 0)
    const lo = p === start.paragraph ? start.grapheme : 0
    const hi = p === end.paragraph ? end.grapheme : length
    if (lo < 0 || hi > length || hi < lo) fail('Range outside paragraph')
    if (lo === hi) continue
    const next: TextRun[] = []
    let offset = 0
    for (const run of paragraph.runs) {
      const pieces = graphemes(run.text)
      const a = Math.max(0, Math.min(pieces.length, lo - offset))
      const b = Math.max(0, Math.min(pieces.length, hi - offset))
      if (a) next.push({ text: pieces.slice(0, a).join(''), overrides: { ...run.overrides } })
      if (b > a) {
        const effective = { ...document.defaults, ...run.overrides }
        const patch = change(effective)
        for (const key of Object.keys(patch) as (keyof CharacterStyle)[]) {
          if (effective[key] !== patch[key]) changed = true
        }
        next.push({ text: pieces.slice(a, b).join(''), overrides: { ...run.overrides, ...patch } })
      }
      if (b < pieces.length) next.push({ text: pieces.slice(b).join(''), overrides: { ...run.overrides } })
      offset += pieces.length
    }
    paragraph.runs = next
  }
  return changed ? normalizeText(copy) : document
}
export function setCharacterProperty(document: TextDocument, range: { anchor: TextPoint, focus: TextPoint },
  property: 'color' | 'fontSize', value: string | number): TextDocument {
  return setCharacterProperties(document, range, { [property]: value })
}

const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const escapeAttr = (value: string) => escapeText(value).replaceAll('"', '&quot;')
const n = (value: number) => String(Number(value.toPrecision(12)))
function renderRuns(runs: TextRun[]): string {
  return runs.map((run) => {
    const text = escapeText(run.text).replaceAll('\n', '<br />')
    if (!Object.keys(run.overrides).length) return text
    const attrs = [
      ['font-family', run.overrides.fontFamily], ['font-size', run.overrides.fontSize], ['font-weight', run.overrides.fontWeight],
      ['font-style', run.overrides.fontStyle], ['color', run.overrides.color], ['line-height', run.overrides.lineHeight],
      ['letter-spacing', run.overrides.letterSpacing], ['decoration', run.overrides.decoration], ['text-case', run.overrides.textCase], ['link', run.overrides.link],
    ].filter(([, value]) => value !== undefined).map(([key, value]) => ` ${key}="${escapeAttr(String(value))}"`).join('')
    return `<StudioRun${attrs}>${text}</StudioRun>`
  }).join('')
}
export function serializeStudioText(input: TextDocument): string {
  const doc = normalizeText(input)
  const { geometry: g, defaults: d } = doc
  const pos = [n(g.x), n(g.y), g.width === null ? 'auto' : n(g.width), g.height === null ? 'auto' : n(g.height)].join(',')
  const attributes = [
    `version="1"`, `id="${escapeAttr(doc.id)}"`, `pos="${pos}"`, `resize="${doc.resizeMode}"`,
    g.rotationDeg < 0 ? `rotate="${n(g.rotationDeg)}"` : `:rotate="${n(g.rotationDeg)}"`,
    ...(g.maxWidth === undefined ? [] : [`max-width="${n(g.maxWidth)}"`]),
    ...(g.affine === undefined ? [] : [`affine="${g.affine.map(n).join(',')}"`]),
    `font-family="${escapeAttr(d.fontFamily)}"`, `:font-size="${n(d.fontSize)}"`, `font-weight="${n(d.fontWeight)}"`,
    `font-style="${d.fontStyle}"`, `color="${escapeAttr(d.color)}"`, `line-height="${escapeAttr(String(d.lineHeight))}"`,
    `letter-spacing="${escapeAttr(String(d.letterSpacing))}"`,
    ...(d.decoration !== 'none' ? [`decoration="${d.decoration}"`] : []),
    ...(d.textCase !== 'none' ? [`text-case="${d.textCase}"`] : []),
    `align="${doc.align}"`,
    `vertical-align="${doc.verticalAlign}"`, ...(doc.styleRef !== undefined ? [`style-ref="${escapeAttr(doc.styleRef)}"`] : []),
  ]
  const explicit = doc.paragraphs.length > 1 || !!doc.paragraphs[0]?.properties.align
  const body = explicit
    ? doc.paragraphs.map(paragraph => `<StudioParagraph${paragraph.properties.align ? ` align="${paragraph.properties.align}"` : ''}>${renderRuns(paragraph.runs)}</StudioParagraph>`).join('')
    : renderRuns(doc.paragraphs[0]?.runs ?? [])
  return `<StudioText ${attributes.join(' ')}>${body}</StudioText>`
}

function mask(source: string): string {
  // Compiler locations use UTF-16 offsets, so keep surrogate halves separate.
  const chars = source.split('')
  const lines = source.match(/[^\n]*\n|[^\n]+$/g) ?? []
  let offset = 0
  let fenced = ''
  let frontmatter = source.startsWith('---\n')
  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    const hidden = frontmatter || !!fenced || !!marker
    if (hidden) for (let i = 0; i < line.length; i++) if (line[i] !== '\n' && line[i] !== '\r') chars[offset + i] = ' '
    if (frontmatter && offset > 0 && line.trim() === '---') frontmatter = false
    else if (fenced && marker?.[1][0] === fenced[0] && marker[1].length >= fenced.length) fenced = ''
    else if (!fenced && marker) fenced = marker[1]
    offset += line.length
  }
  return chars.join('')
}
export function studioTextSpans(source: string): SourceSpan[] {
  const masked = mask(source)
  const errors: string[] = []
  const ast = parse(masked, { comments: true, whitespace: 'preserve', onError: error => errors.push(error.message) })
  if (errors.length) fail(`Unsupported source structure: ${errors[0]}`)
  const spans: SourceSpan[] = []
  for (const child of ast.children) {
    if (child.type !== NodeTypes.ELEMENT || child.tag !== 'StudioText') continue
    const start = child.loc.start.offset
    const lineStart = source.lastIndexOf('\n', start - 1) + 1
    const prefix = source.slice(lineStart, start).trim()
    if (prefix && !prefix.endsWith('</StudioText>')) continue
    const id = child.props.find(prop => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'id') as AttributeNode | undefined
    if (!id?.value) continue
    spans.push({ id: id.value.content, start, end: child.loc.end.offset, source: source.slice(start, child.loc.end.offset) })
  }
  return spans
}
export function uniqueStudioText(source: string, id: string): SourceSpan {
  const matches = studioTextSpans(source).filter(span => span.id === id)
  if (matches.length !== 1) fail(matches.length ? `Ambiguous StudioText ID: ${id}` : `StudioText ID not found: ${id}`)
  return matches[0]
}
