// M3 synthetic browser test. Start Slidev on m3/fixture/slides.md --port 3283.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitFor(check, label) {
  for (let i = 0; i < 180; i++) {
    try { const value = await check(); if (value) return value } catch { /* HMR */ }
    await sleep(150)
  }
  throw Error(`Timed out: ${label}`)
}
const file = path.join(import.meta.dirname, 'fixture', 'pages', '002.md')
const original = await fs.readFile(file)
const profile = path.join(os.tmpdir(), `studio-m3-e2e-${process.pid}`)
const port = crypto.randomInt(40000, 50000)
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--window-size=1920,1080',
    `--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`, 'http://localhost:3283/2'],
  { stdio: 'ignore', windowsHide: true })
let ws; let serial = 1
const pending = new Map()
function command(method, params = {}) {
  const id = serial++
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value
}
const source = () => fs.readFile(file, 'utf8')
const click = async (x, y, count = 1, modifiers = 0) => {
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: count, modifiers })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: count, modifiers })
}
const rect = selector => evaluate(`(() => { const r=document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
  return r ? {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,left:r.left,top:r.top} : null })()`)
const field = label => evaluate(`(() => { const e=document.querySelector('[data-testid="geometry-inspector"] [aria-label=${JSON.stringify(label)}]');
  return e ? {value:e.value,placeholder:e.placeholder,disabled:e.disabled} : null })()`)
async function input(label, value) {
  await waitFor(() => evaluate(`!!document.querySelector('[data-testid="geometry-inspector"] [aria-label=${JSON.stringify(label)}]:not([disabled])')`), `field ${label}`)
  await evaluate(`(() => { const e=document.querySelector('[data-testid="geometry-inspector"] [aria-label=${JSON.stringify(label)}]');
    e.focus(); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event('input',{bubbles:true}));
    e.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
}
async function select(id) {
  await waitFor(() => evaluate(`!!document.querySelector('[data-studio-text-id=${JSON.stringify(id)}]')`), `render ${id}`)
  const r = await rect(`[data-studio-text-id="${id}"]`)
  await click(r.x, r.y)
  await waitFor(() => evaluate(`document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes(${JSON.stringify(id)})`), `select ${id}`)
}
async function drag(selector, slideDx, slideDy, modifiers = 1) {
  const r = await rect(selector)
  assert.ok(r, `missing ${selector}`)
  const scale = await evaluate(`(() => { const e=document.querySelector('#slide-content'); return e.getBoundingClientRect().width / 1920 })()`)
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1, modifiers })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + slideDx*scale, y: r.y + slideDy*scale, button: 'left', modifiers })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + slideDx*scale, y: r.y + slideDy*scale, button: 'left', clickCount: 1, modifiers })
}
async function waitSource(pattern, label) { return waitFor(async () => pattern.test(await source()), label) }
try {
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://localhost:${port}/json`)).json()
    return list.find(item => item.type === 'page' && item.url.includes('3283/2'))
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
  await waitFor(() => evaluate(`!!document.querySelector('[data-studio-text-id="fixed-text"]')`), 'fixture')
  await evaluate(`localStorage.setItem('slidev-studio:open','true'); localStorage.setItem('slidev-studio:panel','inspect'); true`)
  await command('Page.reload')
  await waitFor(() => evaluate(`!!document.querySelector('.studio-dock') && !!document.querySelector('[data-studio-text-id="fixed-text"]')`), 'dock')

  await select('fixed-text')
  assert.equal((await field('X')).value, '120')
  assert.equal((await field('W')).value, '400')
  await input('X', '-25.5')
  await waitSource(/id="fixed-text" pos="-25\.5,180,400,200"/, 'X edit')
  await input('Y', '210.25')
  await waitSource(/id="fixed-text" pos="-25\.5,210\.25,400,200"/, 'Y edit')
  await input('Rotation', '45')
  await waitSource(/id="fixed-text"[^>]*rotate="45"/, 'rotation edit')
  await input('Rotation', '0')
  await waitSource(/id="fixed-text"[^>]*rotate="0"/, 'rotation reset')
  await input('X', '120')
  await input('Y', '180')
  await waitSource(/id="fixed-text" pos="120,180,400,200"/, 'frame reset')
  await select('fixed-text')
  assert.equal(await evaluate(`document.querySelectorAll('.studio-text-handle').length`), 8)

  await drag('.studio-text-handle[style*="left: 100%" ][style*="top: 100%"]', 400, 200)
  await waitSource(/id="fixed-text" pos="120,180,800,400"/, 'fixed resize')
  assert.ok((await source()).includes(':font-size="48"'), 'resize keeps default size')
  assert.ok((await source()).includes('font-size="72"'), 'resize keeps styled range')
  await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]')?.click()`)
  await waitSource(/id="fixed-text" pos="120,180,400,200"/, 'resize undo')
  await input('Scale factor', '2')
  await evaluate(`document.querySelector('[data-testid="geometry-inspector"] [aria-label="Scale text"]')?.click()`)
  await waitSource(/id="fixed-text" pos="-80,80,800,400"[^>]*font-size="96"/, 'scale source')
  assert.ok((await source()).includes('font-size="144"'), 'scale preserves styled run ratio')
  await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]')?.click()`)
  await waitSource(/id="fixed-text" pos="120,180,400,200"/, 'scale undo')

  await select('fixed-text')
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await waitSource(/id="fixed-text" pos="121,180,400,200"/, 'one-unit nudge')
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 8 })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39, modifiers: 8 })
  await waitSource(/id="fixed-text" pos="131,180,400,200"/, 'ten-unit nudge')
  await select('fixed-text')
  const otherRect = await rect('[data-studio-text-id="other-text"]')
  await click(otherRect.x, otherRect.y, 1, 8)
  await waitFor(async () => (await field('X'))?.placeholder === 'Mixed', 'multi-object mixed X')
  await input('X', '300')
  await waitFor(async () => (await source()).match(/pos="300,180,400,200"/) && (await source()).match(/id="other-text" pos="300,600,300,120"/), 'multi-object set X')
  await drag('.studio-text-move', 50, 0)
  await waitFor(async () => (await source()).includes('id="fixed-text" pos="350,180,400,200"')
    && (await source()).includes('id="other-text" pos="350,600,300,120"'), 'multi-object drag')
  await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]')?.click()`)
  await waitFor(async () => (await source()).includes('id="fixed-text" pos="300,180,400,200"')
    && (await source()).includes('id="other-text" pos="300,600,300,120"'), 'multi-object undo')
  await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]')?.click()`)
  await waitFor(async () => (await source()).includes('id="fixed-text" pos="131,180,400,200"')
    && (await source()).includes('id="other-text" pos="960,600,300,120"'), 'multi-object set X undo')

  const baseDeckScale = await evaluate(`Number.parseFloat(document.documentElement.style.getPropertyValue('--studio-deck-scale'))`)
  for (const factor of [0.5, 1, 2]) {
    await evaluate(`document.documentElement.style.setProperty('--studio-deck-scale',${JSON.stringify(String(baseDeckScale * factor))})`)
    await sleep(400)
    await select('fixed-text')
    await drag('.studio-text-move', 50, 0)
    await waitSource(/id="fixed-text" pos="181,180,400,200"/, `50-unit drag at ${factor}x`)
    await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]')?.click()`)
    await waitSource(/id="fixed-text" pos="131,180,400,200"/, `zoom drag undo ${factor}x`)
  }
  await evaluate(`document.documentElement.style.setProperty('--studio-deck-scale',${JSON.stringify(String(baseDeckScale))})`)
  await sleep(300)

  await select('other-text')
  const snapStart = await rect('.studio-text-move')
  const snapScale = await evaluate(`document.querySelector('#slide-content').getBoundingClientRect().width/1920`)
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: snapStart.x, y: snapStart.y, button: 'left', clickCount: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: snapStart.x-144*snapScale, y: snapStart.y, button: 'left' })
  await waitFor(() => evaluate(`document.querySelectorAll('.studio-guide').length > 0`), 'slide-center snap guide')
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: snapStart.x-144*snapScale, y: snapStart.y, button: 'left', clickCount: 1 })
  await waitSource(/id="other-text" pos="810,600,300,120"/, 'slide-center snap')
  await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]')?.click()`)
  await waitSource(/id="other-text" pos="960,600,300,120"/, 'snap undo')
  const altStart = await rect('.studio-text-move')
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: altStart.x, y: altStart.y, button: 'left', clickCount: 1, modifiers: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: altStart.x-144*snapScale, y: altStart.y, button: 'left', modifiers: 1 })
  assert.equal(await evaluate(`document.querySelectorAll('.studio-guide').length`), 0, 'Alt disables snapping guides')
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: altStart.x-144*snapScale, y: altStart.y, button: 'left', clickCount: 1, modifiers: 1 })
  await waitSource(/id="other-text" pos="816,600,300,120"/, 'Alt disables snapping')
  await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]')?.click()`)
  await waitSource(/id="other-text" pos="960,600,300,120"/, 'Alt drag undo')

  await select('auto-width')
  assert.equal((await field('W')).placeholder, 'Auto')
  assert.equal((await field('H')).placeholder, 'Auto')
  const autoWidthBefore = await evaluate(`document.querySelector('[data-studio-text-id="auto-width"]').getBoundingClientRect().width`)
  const beforeLongText = await source()
  await fs.writeFile(file, beforeLongText.replace('Short text', 'Short text becomes much longer after a source edit'))
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="auto-width"]').getBoundingClientRect().width > ${autoWidthBefore + 50}`), 'auto width grows')
  assert.match(await source(), /id="auto-width" pos="620,180,auto,auto"/)
  await fs.writeFile(file, beforeLongText)
  await command('Page.reload')
  await waitFor(() => evaluate(`!!document.querySelector('[data-studio-text-id="auto-width"]')`), 'auto width reset')
  await select('auto-width')
  await input('Resize mode', 'auto-height')
  await waitSource(/id="auto-width" pos="620,180,[0-9.]+,auto" resize="auto-height"/, 'auto width to height')
  await select('auto-height')
  assert.equal((await field('H')).placeholder, 'Auto')
  const heightBefore = await evaluate(`getComputedStyle(document.querySelector('[data-studio-text-id="auto-height"]')).height`)
  const edited = (await source()).replace('This text wraps within a fixed width and its height follows the content.',
    'This text wraps within a fixed width and its height follows the content. '.repeat(5))
  await fs.writeFile(file, edited)
  await waitFor(() => evaluate(`Number.parseFloat(getComputedStyle(document.querySelector('[data-studio-text-id="auto-height"]')).height) > ${Number.parseFloat(heightBefore) + 20}`), 'auto height grows')
  assert.match(await source(), /id="auto-height" pos="950,180,300,auto"/)
  const widthAfter = await evaluate(`document.querySelector('[data-studio-text-id="auto-width"]').getBoundingClientRect().width`)
  assert.ok(widthAfter > 0 && autoWidthBefore > 0)

  await command('Page.reload')
  await select('auto-height')
  const heightBeforeFont = await evaluate(`Number.parseFloat(getComputedStyle(document.querySelector('[data-studio-text-id="auto-height"]')).height)`)
  await evaluate(`(() => { const e=document.querySelector('[data-testid="typography-inspector"] [aria-label="Font size"]');
    e.focus(); e.value='48'; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  await waitSource(/id="auto-height" pos="950,180,300,auto"[^>]*font-size="48"/, 'auto-height font update')
  await waitFor(() => evaluate(`Number.parseFloat(getComputedStyle(document.querySelector('[data-studio-text-id="auto-height"]')).height) > ${heightBeforeFont + 20}`), 'auto-height remeasures after font change')
  assert.match(await source(), /id="auto-height" pos="950,180,300,auto"/)

  const beforeOverflow = await source()
  await fs.writeFile(file, beforeOverflow.replace('Hello <StudioRun', `${'Very long fixed text '.repeat(40)}<StudioRun`))
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="fixed-text"]')?.textContent?.includes('Very long fixed text')`), 'fixed overflow fixture')
  const overflow = await evaluate(`(() => { const e=document.querySelector('[data-studio-text-id="fixed-text"]'); const s=getComputedStyle(e);
    return {w:s.width,h:s.height,overflow:s.overflow,contentHeight:e.scrollHeight} })()`)
  assert.deepEqual({ w: overflow.w, h: overflow.h, overflow: overflow.overflow },
    { w: '400px', h: '200px', overflow: 'visible' })
  assert.ok(overflow.contentHeight > 200, 'fixed content visibly overflows')
  assert.match(await source(), /id="fixed-text" pos="131,180,400,200"/)
  await fs.writeFile(file, beforeOverflow)

  await command('Page.reload')
  await waitFor(() => evaluate(`!!document.querySelector('[data-studio-text-id="rotated-text"]')`), 'reload after source edit')
  await select('rotated-text')
  await drag('.studio-text-move', 50, 0)
  await waitSource(/id="rotated-text" pos="250,600,500,150"/, 'rotated drag')
  await waitFor(() => evaluate(`!!document.querySelector('.studio-text-handle')`), 'rotated handles')
  await drag('.studio-text-handle[style*="left: 100%" ][style*="top: 50%"]', 70.710678, 70.710678)
  await waitSource(/id="rotated-text" pos="[^"]*600,150"/, 'rotated local resize')
  const afterResize = await source()
  assert.ok(afterResize.includes('rotate="45"'))
  const pivot = await evaluate(`(() => {
    const host=document.querySelector('[data-studio-text-id="rotated-text"]'); const r=host.getBoundingClientRect();
    return {x:r.left+r.width/2,y:r.top+r.height/2} })()`)
  const handle = await rect('.studio-text-rotate')
  const radians = 15*Math.PI/180
  const vx = handle.x-pivot.x; const vy = handle.y-pivot.y
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1, modifiers: 8 })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pivot.x+vx*Math.cos(radians)-vy*Math.sin(radians),
    y: pivot.y+vx*Math.sin(radians)+vy*Math.cos(radians), button: 'left', modifiers: 8 })
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pivot.x+vx*Math.cos(radians)-vy*Math.sin(radians),
    y: pivot.y+vx*Math.sin(radians)+vy*Math.cos(radians), button: 'left', clickCount: 1, modifiers: 8 })
  await waitSource(/id="rotated-text"[^>]*rotate="60"/, 'pointer rotation shift snap')
  await evaluate(`document.querySelector('[data-testid="typography-inspector"] [aria-label="Undo text"]')?.click()`)
  await waitSource(/id="rotated-text"[^>]*rotate="45"/, 'pointer rotation undo')
  await evaluate(`document.querySelector('[data-studio-text-id="rotated-text"]')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`)
  await waitFor(() => evaluate(`document.querySelector('[data-studio-text-id="rotated-text"]')?.isContentEditable`), 'rotated edit')
  await evaluate(`(() => { const host=document.querySelector('[data-studio-text-id="rotated-text"]');
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);
    let node; while ((node=walker.nextNode()) && !node.textContent.includes('words')) {}
    const range=document.createRange(); const start=node.textContent.indexOf('words'); range.setStart(node,start); range.setEnd(node,start+5);
    const selection=window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange')); return true })()`)
  await waitFor(() => evaluate(`document.querySelector('[data-testid="typography-inspector"]')?.textContent?.includes('Selected text range')`), 'rotated range')
  await evaluate(`(() => { const e=document.querySelector('[data-testid="typography-inspector"] [aria-label="Text color hex"]');
    e.focus(); e.value='#00ff00'; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
  await waitSource(/color="#00ff00">words<\/StudioRun>/, 'rotated word color')
  await evaluate(`document.querySelector('[data-studio-text-id="rotated-text"]')?.focus()`)
  const beforeEditArrow = await source()
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await sleep(200)
  assert.equal(await source(), beforeEditArrow, 'caret arrow does not nudge text object')
  await fs.writeFile(path.join(import.meta.dirname, 'fixture', 'pages', '002-formatted.md'), await source())
  await command('Page.reload')
  await waitFor(() => evaluate(`!!document.querySelector('[data-studio-text-id="other-text"]')`), 'reload for stale gesture')
  await select('other-text')
  const staleBefore = await source()
  const moveRect = await rect('.studio-text-move')
  const scale = await evaluate(`document.querySelector('#slide-content').getBoundingClientRect().width/1920`)
  await command('Input.dispatchMouseEvent', { type: 'mousePressed', x: moveRect.x, y: moveRect.y, button: 'left', clickCount: 1, modifiers: 1 })
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: moveRect.x+50*scale, y: moveRect.y, button: 'left', modifiers: 1 })
  const external = `${staleBefore}\n<!-- External edit during drag. -->\n`
  await fs.writeFile(file, external)
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: moveRect.x+50*scale, y: moveRect.y, button: 'left', clickCount: 1, modifiers: 1 })
  await waitFor(async () => (await source()) === external, 'stale gesture preserves external source')
  await waitFor(() => evaluate(`document.querySelector('[data-testid="geometry-inspector"]')?.textContent?.includes('Reload before changing geometry')`), 'stale gesture reason')
  const result = { gate: 'PASS', numeric: true, resizeVsScale: true, autoMode: true, rotatedMoveResizeText: true,
    browserZoomFactors: [0.5,1,2], multiObject: true, pointerRotation: true, staleGesture: true,
    snapGuideAndAlt: true, autoHeightFontRemeasure: true, fixedOverflow: true, caretArrowIsNotNudge: true,
    originalSha256: crypto.createHash('sha256').update(original).digest('hex') }
  await fs.writeFile(path.join(import.meta.dirname, 'e2e-results.json'), `${JSON.stringify(result, null, 2)}\n`)
  const screenshot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await fs.writeFile(path.join(import.meta.dirname, 'e2e-final.png'), Buffer.from(screenshot.data, 'base64'))
  console.log('PASS: M3 geometry fields, resize/scale, auto modes, rotated move/resize/text')
}
finally {
  await fs.writeFile(file, original)
  ws?.close(); chrome.kill(); await sleep(350)
  try { await fs.rm(profile, { recursive: true, force: true }) } catch { /* profile lock */ }
}
