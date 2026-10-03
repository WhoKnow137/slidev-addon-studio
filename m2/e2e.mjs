// M2 synthetic end-to-end test. Start Slidev on m2/fixture/slides.md --port 3282.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(check, label) {
  for (let i = 0; i < 160; i++) {
    try { const result = await check(); if (result) return result } catch { /* HMR */ }
    await sleep(150)
  }
  throw Error(`Timed out: ${label}`)
}
const file = path.join(import.meta.dirname, 'fixture', 'pages', '002.md')
const original = await fs.readFile(file)
const port = crypto.randomInt(40000, 50000)
const profile = path.join(os.tmpdir(), `studio-m2-e2e-${process.pid}`)
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1920,1080',
    `--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'http://localhost:3282/2'],
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
const input = async (label, value) => {
  await waitFor(() => evaluate(`(() => { const el=document.querySelector('[data-testid="typography-inspector"] [aria-label=${JSON.stringify(label)}]'); return !!el && !el.disabled; })()`), `ready ${label}`)
  return evaluate(`(() => {
  const el=document.querySelector('[data-testid="typography-inspector"] [aria-label=${JSON.stringify(label)}]');
  if(!el) throw Error('Missing field: ${label}');
  el.focus();
  el.value=${JSON.stringify(value)};
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return true;
})()`)
}
const click = async label => evaluate(`(() => {
  const el=document.querySelector('[data-testid="typography-inspector"] [aria-label=${JSON.stringify(label)}]');
  if(!el) throw Error('Missing button: ${label}');
  el.click(); return true;
})()`)
const field = label => evaluate(`(() => {
  const el=document.querySelector('[data-testid="typography-inspector"] [aria-label=${JSON.stringify(label)}]');
  return el ? {value:el.value,placeholder:el.placeholder,disabled:el.disabled,title:el.title} : null;
})()`)
async function selectObject(id) {
  await waitFor(() => evaluate(`!!document.querySelector('[data-studio-text-id=${JSON.stringify(id)}]')`), `render ${id}`)
  const coordinate = await evaluate(`(() => {
    const el=document.querySelector('[data-studio-text-id=${JSON.stringify(id)}]');
    const r=el.getBoundingClientRect(); return {x:r.left+Math.min(r.width/2,350),y:r.top+r.height/2};
  })()`)
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: coordinate.x, y: coordinate.y, button: 'left', clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coordinate.x, y: coordinate.y, button: 'left', clickCount: 1 })
  await waitFor(() => evaluate(`document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes(${JSON.stringify(id)})`), `inspector for ${id}`)
}
async function selectWord() {
  const result = await evaluate(`(() => {
    const el=document.querySelector('[data-studio-text-id="type-test"]');
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    let node; while ((node=walker.nextNode()) && !node.textContent.includes('world')) {}
    const range=document.createRange(); const start=node.textContent.indexOf('world');
    range.setStart(node,start); range.setEnd(node,start+5);
    const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange')); return selection.toString();
  })()`)
  assert.equal(result.toLowerCase(), 'world')
  await waitFor(() => evaluate(`document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes('Selected text range')`), 'range mode')
}
try {
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://localhost:${port}/json`)).json()
    return list.find(item => item.type === 'page' && item.url.includes('3282/2'))
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
  await waitFor(() => evaluate(`!!document.querySelector('[data-studio-text-id="type-test"]')`), 'StudioText render')
  await evaluate(`localStorage.setItem('slidev-studio:open','true'); localStorage.setItem('slidev-studio:panel','inspect'); true`)
  await command('Page.reload')
  await waitFor(() => evaluate(`!!document.querySelector('.studio-dock') && !!document.querySelector('[data-studio-text-id="type-test"]')`), 'Studio dock')
  await selectObject('type-test')
  assert.equal((await field('Font family')).value, 'Inter')
  assert.equal((await field('Font size')).value, '64')
  const initial = await source()
  for (const [label, value, expected] of [
    ['Font family', 'Inter Tight', 'font-family="Inter Tight"'],
    ['Font weight', '700', 'font-weight="700"'],
    ['Font size', '70', ':font-size="70"'],
    ['Text color hex', '#224466', 'color="#224466"'],
    ['Line height', '1.2', 'line-height="1.2"'],
    ['Letter spacing', '-1.5px', 'letter-spacing="-1.5px"'],
    ['Horizontal alignment', 'center', 'align="center"'],
    ['Vertical alignment', 'bottom', 'vertical-align="bottom"'],
    ['Text case', 'uppercase', 'text-case="uppercase"'],
  ]) {
    await input(label, value)
    await waitFor(async () => (await source()).includes(expected), `object ${label}`)
  }
  const objectSource = await source()
  assert.equal(objectSource.slice(0, objectSource.indexOf('<StudioText')), initial.slice(0, initial.indexOf('<StudioText')))
  assert.equal(objectSource.slice(objectSource.indexOf('</StudioText>') + 13), initial.slice(initial.indexOf('</StudioText>') + 13))
  await command('Page.reload')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="type-test"]')?.style.textTransform === 'uppercase'`), 'object style after reload')
  await selectObject('type-test')
  assert.equal((await field('Font family')).value, 'Inter Tight')
  assert.equal((await field('Font weight')).value, '700')
  await click('Undo text')
  await waitFor(async () => !(await source()).includes('text-case="uppercase"'), 'undo case')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="type-test"]')?.style.textTransform !== 'uppercase'`), 'visual undo')
  await click('Redo text')
  await waitFor(async () => (await source()).includes('text-case="uppercase"'), 'redo case')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="type-test"]')?.style.textTransform === 'uppercase'`), 'visual redo')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="type-test"]')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`), 'enter range editing')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="type-test"]')?.isContentEditable`), 'text editing')
  await selectWord()
  for (const [label, value, expected] of [
    ['Font weight', '400', 'font-weight="400"'],
    ['Text color hex', '#ff3344', 'color="#ff3344"'],
    ['Font size', '72', 'font-size="72"'],
  ]) {
    await input(label, value)
    await waitFor(async () => (await source()).includes(expected + '>world') || (await source()).includes(expected + ' '), `range ${label}`)
    await waitFor(() => evaluate(`window.getSelection()?.toString().toLowerCase() === 'world'`), `selection after ${label}`)
  }
  await click('underline')
  await waitFor(async () => (await source()).includes('decoration="underline"'), 'range underline')
  const rangeSource = await source()
  assert.equal(rangeSource.slice(0, rangeSource.indexOf('<StudioText')), initial.slice(0, initial.indexOf('<StudioText')))
  assert.equal(rangeSource.slice(rangeSource.indexOf('</StudioText>') + 13), initial.slice(initial.indexOf('</StudioText>') + 13))
  assert.equal((await field('Font size')).value, '72')
  const mixed = await evaluate(`(() => {
    const el=document.querySelector('[data-studio-text-id="type-test"]');
    const range=document.createRange(); range.selectNodeContents(el);
    const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange')); return selection.toString();
  })()`)
  assert.ok(mixed.toLowerCase().includes('hello world'))
  await waitFor(async () => (await field('Font size'))?.placeholder === 'Mixed', 'mixed size in inspector')
  await input('Font size', '80')
  await waitFor(async () => (await field('Font size'))?.value === '80', 'unified size')
  await fs.writeFile(path.join(import.meta.dirname, 'fixture', 'pages', '002-formatted.md'), await source())
  await command('Page.reload')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="type-test"] .studio-text-run')?.style.fontSize === '80px'`), 'range style after reload')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="type-test"]')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`), 'enter caret editing')
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="type-test"]')?.isContentEditable`), 'caret editing')
  await evaluate(`(() => {
    const host=document.querySelector('[data-studio-text-id="type-test"]');
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
    const node=walker.nextNode(); const range=document.createRange();
    range.setStart(node,Math.min(2,node.textContent.length)); range.collapse(true);
    const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange')); return true;
  })()`)
  await waitFor(() => evaluate(`document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes('Caret typing style')`), 'caret mode')
  const beforeCaret = await source()
  await input('Font family', 'Courier New')
  await waitFor(async () => (await field('Font family'))?.value === 'Courier New', 'caret typing style')
  assert.equal(await source(), beforeCaret, 'caret formatting must not rewrite surrounding text')
  await click('Undo text')
  await waitFor(async () => (await field('Font family'))?.value === 'Inter Tight', 'caret undo')
  await click('Redo text')
  await waitFor(async () => (await field('Font family'))?.value === 'Courier New', 'caret redo')
  assert.equal(await source(), beforeCaret, 'caret undo/redo preserves source bytes')
  await selectObject('unsupported-text')
  await waitFor(() => evaluate(`document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes('Unsupported nested element')`), 'unsupported reason')
  assert.equal((await field('Font size')).disabled, true)
  const decoration = await evaluate(`(() => {
    const host=document.querySelector('[data-studio-text-id="decoration-test"]');
    return {base:host?.querySelector('span')?.style.textDecorationLine,
      override:host?.querySelector('.studio-text-run')?.style.textDecorationLine};
  })()`)
  assert.deepEqual(decoration, { base: 'underline', override: 'none' }, 'range can remove inherited underline visually')
  const verticalPosition = () => evaluate(`(() => {
    const host=document.querySelector('[data-studio-text-id="vertical-test"]');
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
    let node; while ((node=walker.nextNode()) && !node.textContent.includes('VERTICAL')) {}
    const range=document.createRange(); range.selectNodeContents(node);
    return range.getBoundingClientRect().top-host.getBoundingClientRect().top;
  })()`)
  await selectObject('vertical-test')
  const verticalTop = await verticalPosition()
  await input('Vertical alignment', 'center')
  await waitFor(async () => (await source()).includes('id="vertical-test"') && (await source()).includes('vertical-align="center">VERTICAL'), 'vertical center source')
  const verticalCenter = await waitFor(async () => {
    const y = await verticalPosition(); return y > verticalTop + 20 ? y : false
  }, 'vertical center position')
  await input('Vertical alignment', 'bottom')
  await waitFor(async () => (await source()).includes('vertical-align="bottom">VERTICAL'), 'vertical bottom source')
  const verticalBottom = await waitFor(async () => {
    const y = await verticalPosition(); return y > verticalCenter + 20 ? y : false
  }, 'vertical bottom position')
  const result = { gate: 'PASS', objectProperties: 9, rangeProperties: 4, caretTypingStyle: true,
    reload: true, undoRedo: true,
    mixedResolution: true, unsupportedReason: true, decorationInheritance: decoration,
    verticalPositions: { top: verticalTop, center: verticalCenter, bottom: verticalBottom },
    onlySelectedSubtreeChanged: true,
    originalSha256: crypto.createHash('sha256').update(original).digest('hex') }
  await fs.writeFile(path.join(import.meta.dirname, 'e2e-results.json'), `${JSON.stringify(result, null, 2)}\n`)
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await fs.writeFile(path.join(import.meta.dirname, 'e2e-final.png'), Buffer.from(screenshot.data, 'base64'))
  console.log('PASS: M2 object/range typography, reload, undo/redo, mixed and unsupported states')
}
finally {
  await fs.writeFile(file, original)
  ws?.close()
  chrome.kill()
  await sleep(350)
  try { await fs.rm(profile, { recursive: true, force: true }) } catch { /* profile lock */ }
}
