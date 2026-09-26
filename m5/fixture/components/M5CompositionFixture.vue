<script setup lang="ts">
// Public event simulation; this component is a test fixture, never part of the packaged addon.
import { ref, onMounted, onBeforeUnmount } from 'vue'
const development = import.meta.env.DEV
const result = ref('Double click Variable text first, then run a composition test.')
const busy = ref(false)
const refreshResult = () => { result.value = sessionStorage.getItem('m5-ime-result') ?? result.value }
onMounted(() => { refreshResult(); window.addEventListener('m5-ime-result', refreshResult) })
onBeforeUnmount(() => window.removeEventListener('m5-ime-result', refreshResult))
const samples = {
  Japanese: { updates: ['n', 'に', '日本'], final: '日本語' },
  Chinese: { updates: ['z', 'zh', '中'], final: '中文' },
  Korean: { updates: ['ㅎ', '하', '한'], final: '한국어' },
}
function selectRange(kind: 'across' | 'second' | 'link') {
  const host = document.querySelector<HTMLElement>('[data-studio-text-id="m5-paragraphs"][contenteditable="true"]')
  if (!host) { result.value = 'Double click paragraph text first.'; return }
  const parts = [...host.querySelectorAll('p')]
  const range = document.createRange()
  const firstText = (part: Node) => { const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT); let text: Node | null; do { text = walker.nextNode() } while (text && !text.textContent); return text! }
  if (kind === 'across') { range.setStart(firstText(parts[0]), 8); range.setEnd(firstText(parts[2].querySelector('a')!), 6) }
  else if (kind === 'second') { range.selectNodeContents(parts[1]) }
  else { range.selectNodeContents(parts[2].querySelector('a')!) }
  const selected = window.getSelection()!
  selected.removeAllRanges(); selected.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}
async function compose(language: keyof typeof samples) {
  const host = document.querySelector<HTMLElement>('[data-studio-text-id="m5-variable"][contenteditable="true"]')
  if (!host) { result.value = 'BLOCKED: enter Variable text editing first.'; return }
  busy.value = true
  const originalFetch = window.fetch
  let commits = 0
  const requests: Promise<unknown>[] = []
  window.fetch = (...args) => {
    const response = originalFetch(...args)
    if (String(args[0]) === '/@studio/text' && args[1]?.method === 'POST') {
      const body = JSON.parse(String(args[1].body))
      if (body.action === 'content') { commits++; requests.push(response.then(r => r.clone().json())) }
    }
    return response
  }
  try {
    const text = host.firstChild!
    const range = document.createRange()
    range.setStart(text, 0); range.collapse(true)
    const selection = window.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    host.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }))
    for (const data of samples[language].updates) {
      host.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data }))
      host.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertCompositionText', data, isComposing: true }))
    }
    const intermediate = commits
    host.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: samples[language].final }))
    host.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: samples[language].final }))
    await new Promise(resolve => setTimeout(resolve, 450))
    const responses: any[] = await Promise.all(requests)
    const response = responses[0]
    const content = response?.document?.paragraphs.map((p: any) => p.runs.map((r: any) => r.text).join('')).join('\n')
    const valid = intermediate === 0 && commits === 1 && content?.startsWith(samples[language].final)
      && response?.selection?.at?.grapheme === Array.from(samples[language].final).length
    result.value = `${valid ? 'PASS' : 'FAIL'} ${language}: intermediate=${intermediate}; final=${commits}; caret=${response?.selection?.at?.grapheme}; Unicode=${content?.startsWith(samples[language].final)}`
    sessionStorage.setItem('m5-ime-result', result.value)
    window.dispatchEvent(new Event('m5-ime-result'))
  }
  finally { window.fetch = originalFetch; busy.value = false }
}
</script>
<template>
  <aside v-if="development" class="slidev-studio m5-event-fixture">
    <button v-for="(_, name) in samples" :key="name" :disabled="busy" @mousedown.prevent @click="compose(name)">Compose {{ name }}</button>
    <output aria-label="IME event result">{{ result }}</output>
    <button @mousedown.prevent @click="selectRange('across')">Select three paragraphs</button>
    <button @mousedown.prevent @click="selectRange('second')">Select RTL paragraph</button>
    <button @mousedown.prevent @click="selectRange('link')">Select linked range</button>
  </aside>
</template>
<style scoped>
.m5-event-fixture { position: absolute; right: 8px; top: 8px; display: flex; flex-direction: column; z-index: 20; font: 12px monospace; max-width: 250px; background: #222; color: white; padding: 8px; }
.m5-event-fixture button { padding: 4px; border: 1px solid #777; }
</style>
