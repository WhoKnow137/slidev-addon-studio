import type { StudioSelection, TextDocument, TextPoint, TextRun } from './studiotext'
import { graphemes, normalizeText, orderedRange } from './studiotext'

export interface ContentOutcome { document: TextDocument, selection: StudioSelection, noOp: boolean }
function runLength(runs: TextRun[]) { return runs.reduce((sum, run) => sum + graphemes(run.text).length, 0) }
function before(runs: TextRun[], at: number): TextRun[] {
  const output: TextRun[] = []
  let offset = 0
  for (const run of runs) {
    const parts = graphemes(run.text)
    const length = Math.max(0, Math.min(parts.length, at - offset))
    if (length) output.push({ text: parts.slice(0, length).join(''), overrides: { ...run.overrides } })
    offset += parts.length
  }
  return output
}
function after(runs: TextRun[], at: number): TextRun[] {
  const output: TextRun[] = []
  let offset = 0
  for (const run of runs) {
    const parts = graphemes(run.text)
    const start = Math.max(0, Math.min(parts.length, at - offset))
    if (start < parts.length) output.push({ text: parts.slice(start).join(''), overrides: { ...run.overrides } })
    offset += parts.length
  }
  return output
}
function styleAt(runs: TextRun[], at: number): TextRun['overrides'] {
  let offset = 0
  for (const run of runs) {
    const length = graphemes(run.text).length
    if (at <= offset + length) return { ...run.overrides }
    offset += length
  }
  return { ...(runs.at(-1)?.overrides ?? {}) }
}
function checkPoint(doc: TextDocument, point: TextPoint) {
  if (!Number.isSafeInteger(point.paragraph) || !Number.isSafeInteger(point.grapheme)
    || point.paragraph < 0 || point.paragraph >= doc.paragraphs.length
    || point.grapheme < 0 || point.grapheme > runLength(doc.paragraphs[point.paragraph].runs)) throw Error('Text point outside document')
}
export function replaceText(document: TextDocument, selection: StudioSelection, input: string): ContentOutcome {
  if (selection.mode === 'objects' || selection.textId !== document.id) throw Error('Select a text caret or range')
  if (typeof input !== 'string' || input.length > 10_000 || /\r|[\u0000-\u0008\u000b-\u001f\u007f]/.test(input)) throw Error('Invalid text input')
  const [start, end] = selection.mode === 'textCaret' ? [selection.at, selection.at] : orderedRange(selection)
  checkPoint(document, start); checkPoint(document, end)
  if (start.paragraph === end.paragraph && start.grapheme === end.grapheme && input === '')
    return { document, selection, noOp: true }
  const copy = structuredClone(document)
  const first = copy.paragraphs[start.paragraph]
  const last = copy.paragraphs[end.paragraph]
  const insert: TextRun[] = input ? [{ text: input,
    overrides: { ...styleAt(first.runs, start.grapheme), ...(selection.mode === 'textCaret' ? selection.typingStyle : {}) } }] : []
  const joined = { properties: first.properties,
    runs: [...before(first.runs, start.grapheme), ...insert, ...after(last.runs, end.grapheme)] }
  copy.paragraphs.splice(start.paragraph, end.paragraph - start.paragraph + 1, joined)
  if (copy.localParagraphs && start.paragraph !== end.paragraph)
    copy.localParagraphs.splice(start.paragraph + 1, end.paragraph - start.paragraph)
  const caret: TextPoint = { paragraph: start.paragraph, grapheme: start.grapheme + graphemes(input).length }
  return { document: normalizeText(copy), selection: { mode: 'textCaret', textId: document.id, at: caret }, noOp: false }
}
