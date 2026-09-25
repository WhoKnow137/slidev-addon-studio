// Deterministic M1 browser integration against a disposable Slidev fixture.
// Start: node_modules/.bin/slidev.cmd m1/fixture/slides.md --port 3281
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(check, label) {
  for (let i = 0; i < 120; i++) {
    try { const result = await check(); if (result) return result } catch { /* HMR */ }
    await sleep(150)
  }
  throw Error(`Timed out: ${label}`)
}
const file = path.join(import.meta.dirname, 'fixture', 'pages', '002.md')
const original = await fs.readFile(file)
const port = crypto.randomInt(40000, 50000)
const profile = path.join(os.tmpdir(), `studio-m1-e2e-${process.pid}`)
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1920,1080',
    `--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'http://localhost:3281/2'],
  { stdio: 'ignore', windowsHide: true })
let ws
let serial = 1
const pending = new Map()
function command(method, params = {}) {
  const id = serial++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const answer = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (answer.exceptionDetails) throw Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text)
  return answer.result?.value
}
const source = () => fs.readFile(file, 'utf8')
const setField = async (label, value) => {
  await waitFor(() => evaluate(`(() => { const el=document.querySelector('[data-testid="typography-inspector"] [aria-label=${JSON.stringify(label)}]'); return !!el && !el.disabled; })()`), `ready ${label}`)
  return evaluate(`(() => { const input=document.querySelector('[data-testid="typography-inspector"] [aria-label=${JSON.stringify(label)}]'); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
}
const selectWord = () => evaluate(`(() => {
  const el=document.querySelector('[data-studio-text-id="word-test"]');
  const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
  let node; while ((node=walker.nextNode()) && !node.textContent.includes('world')) {}
  const range=document.createRange();
  const start=node.textContent.indexOf('world');
  range.setStart(node,start); range.setEnd(node,start+5);
  const selected=window.getSelection(); selected.removeAllRanges(); selected.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  return {word:selected.toString(), editable:el.isContentEditable};
})()`)
try {
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://localhost:${port}/json`)).json()
    return list.find(item => item.type === 'page' && item.url.includes('3281/2'))
  }, 'Chrome target')
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }) })
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (!message.id) return
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result)
  })
  await waitFor(() => evaluate(`!!document.querySelector('[data-studio-text-id="word-test"]')`), 'StudioText component')
  await evaluate(`localStorage.setItem('slidev-studio:open','true'); localStorage.setItem('slidev-studio:panel','inspect'); true`)
  await command('Page.reload')
  await waitFor(() => evaluate(`!!document.querySelector('.studio-dock') && !!document.querySelector('[data-studio-text-id="word-test"]')`), 'Studio editor')
  const coordinate = await evaluate(`(() => { const el=document.querySelector('[data-studio-text-id="word-test"]'); const r=el.getBoundingClientRect(); return {x:r.left+Math.min(r.width/2,400),y:r.top+r.height/2}; })()`)
  for (const clickCount of [1, 2]) {
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: coordinate.x, y: coordinate.y, button: 'left', clickCount })
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coordinate.x, y: coordinate.y, button: 'left', clickCount })
  }
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="typography-inspector"]')`), 'typography inspector after double-click')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="word-test"]')?.isContentEditable`), 'editable text after double-click')
  const genericGuard = await evaluate(`(() => {
    const dock=document.querySelector('.studio-dock');
    const hint=!!dock.querySelector('[data-testid="typography-inspector"]');
    const oldInspector=[...dock.querySelectorAll('.studio-section__title')].some(el=>['Position','Style','Arrange','Markdown'].includes(el.textContent.trim()));
    const handles=document.querySelectorAll('.studio-frame .studio-move:not(.studio-text-move), .studio-frame .studio-handle:not(.studio-text-handle):not(.studio-text-rotate)').length;
    const textHandles=document.querySelectorAll('.studio-frame .studio-text-handle').length;
    return {hint,oldInspector,handles,textHandles};
  })()`)
  assert.deepEqual(genericGuard, { hint: true, oldInspector: false, handles: 0, textHandles: 8 }, 'generic inspector stays guarded; managed geometry handles are present')
  const word = await selectWord()
  assert.deepEqual(word, { word: 'world', editable: true })
  await waitFor(() => evaluate(`document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes('Selected text range')`), 'model range')
  const initial = await source()
  await setField('Text color hex', '#ff3344')
  const colored = await waitFor(async () => { const value = await source(); return value.includes('color="#ff3344">world</StudioRun>') ? value : null }, 'color transaction')
  await waitFor(() => evaluate(`window.getSelection()?.toString() === 'world'`), 'word selection after color HMR')
  assert.equal(colored.slice(0, colored.indexOf('<StudioText')), initial.slice(0, initial.indexOf('<StudioText')))
  assert.equal(colored.slice(colored.indexOf('</StudioText>') + 13), initial.slice(initial.indexOf('</StudioText>') + 13))
  await setField('Font size', '72')
  const formatted = await waitFor(async () => { const value = await source(); return value.includes('font-size="72" color="#ff3344">world') ? value : null }, 'size transaction')
  await waitFor(() => evaluate(`window.getSelection()?.toString() === 'world'`), 'word selection after size HMR')
  await fs.writeFile(path.join(import.meta.dirname, 'fixture', 'pages', '002-formatted.md'), formatted)
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await fs.writeFile(path.join(import.meta.dirname, 'e2e-formatted.png'), Buffer.from(screenshot.data, 'base64'))
  await command('Page.reload')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="word-test"] .studio-text-run')?.style.fontSize === '72px'`), 'font size after browser reload')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="word-test"] .studio-text-run')?.style.color === 'rgb(255, 51, 68)'`), 'color after browser reload')
  // Re-enter after page reload. The session ID survives and server-side history
  // remains in the same dev process.
  await evaluate(`document.querySelector('[data-studio-text-id="word-test"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]:not([disabled])')`), 'controls after reload')
  await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]')?.click()`)
  await waitFor(async () => (await source()) === colored, 'undo size')
  await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Redo text"]')?.click()`)
  await waitFor(async () => (await source()) === formatted, 'redo size')
  await selectWord()
  const external = `${await source()}\nExternal editor change.\n`
  await fs.writeFile(file, external)
  await setField('Text color hex', '#00ff00')
  await waitFor(() => evaluate(`document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes('Source changed outside this editor')`), 'stale editor state')
  assert.equal(await source(), external, 'stale write changes zero bytes')
  await evaluate(`[...document.querySelectorAll('[data-testid="typography-inspector"] button')].find(el=>el.textContent.includes('Reload text'))?.click()`)
  await waitFor(() => evaluate(`!document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes('Source changed outside this editor')`), 'explicit source reload')
  await evaluate(`document.querySelector('[data-studio-text-id="unsupported-text"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
  await waitFor(() => evaluate(`document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes('Unsupported nested element')`), 'unsupported-source reason')
  assert.equal(await evaluate(`document.querySelector('[data-studio-text-id="unsupported-text"]')?.textContent`), 'Unsupported markup remains visible.')
  assert.equal(await source(), external, 'unsupported source remains byte-identical')
  const result = { gate: 'PASS', originalSha256: crypto.createHash('sha256').update(original).digest('hex'),
    coloredSha256: crypto.createHash('sha256').update(colored).digest('hex'),
    formattedSha256: crypto.createHash('sha256').update(formatted).digest('hex'),
    wordSelection: word, controls: true, colorAndSizeSurvivedReload: true, undoRedo: true,
    changedSubtreeOnly: true, staleExternalEditRefusedWithZeroByteChange: true, explicitReloadRequired: true,
    unsupportedSourceVisibleAndUnchanged: true, genericInspectorGuard: genericGuard }
  await fs.writeFile(path.join(import.meta.dirname, 'e2e-results.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log('PASS: double-click, model word range, color, size, reload, undo, redo, minimal diff')
}
finally {
  await fs.writeFile(file, original)
  ws?.close()
  chrome.kill()
  await sleep(350)
  try { await fs.rm(profile, { recursive: true, force: true }) } catch { /* profile lock */ }
}
