import { describe, expect, it } from 'vitest'
import { TextCompositionBuffer } from '../shared/composition'
import type { StudioSelection } from '../shared/studiotext'

const selected: StudioSelection = { mode: 'textCaret', textId: 'ime', at: { paragraph: 0, grapheme: 2 } }

describe('M5 deterministic IME composition fixture', () => {
  it.each([
    ['Japanese', ['n', 'に', '日本'], '日本語'],
    ['Chinese Pinyin', ['z', 'zh', '中'], '中文'],
    ['Korean', ['ㅎ', '하', '한'], '한국어'],
  ])('%s buffers intermediate candidates and yields one final edit', (_language, updates, final) => {
    const buffer = new TextCompositionBuffer()
    buffer.start(selected)
    for (const candidate of updates) {
      buffer.update(candidate)
      expect(buffer.active).toBe(true)
    }
    expect(buffer.finish(final)).toEqual({ selection: selected, text: final })
    expect(buffer.active).toBe(false)
    expect(buffer.finish(final)).toBeNull()
  })
  it('treats empty compositionend as cancellation and permits explicit cancellation', () => {
    const buffer = new TextCompositionBuffer()
    buffer.start(selected)
    buffer.update('漢字')
    expect(buffer.finish('')).toBeNull()
    buffer.start(selected)
    buffer.cancel()
    expect(buffer.finish('ignored')).toBeNull()
  })
})
