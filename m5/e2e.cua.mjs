// Reusable browser regression for the public fixture through the documented CUA API.
// The caller supplies readSource() / readStyles() filesystem readers; no private files.
export async function runM5BrowserRegression(tab, { readSource, readStyles, offsetY = 0 }) {
  const assert = (value, label) => { if (!value) throw Error(label) }
  const source = await readSource(), styles = await readStyles()
  const results = []
  const wait = async (predicate, label) => {
    for (let i = 0; i < 80; i++) {
      if (await predicate()) return
      await tab.playwright.domSnapshot()
    }
    throw Error(`Timed out: ${label}`)
  }
  const select = async id => {
    const point = await tab.playwright.evaluate(id => {
      const box = document.querySelector(`[data-studio-text-id="${id}"]`).getBoundingClientRect()
      return { x: box.x + 20, y: box.y + box.height / 2 }
    }, id)
    await tab.click([point.x, point.y + offsetY])
    await wait(async () => (await tab.playwright.domSnapshot()).includes(id), 'inspector selection')
  }
  const press = name => tab.playwright.getByRole('button', { name, exact: true }).press('Enter')
  const undo = async () => {
    const before = await readSource()
    await press('Undo text')
    await wait(async () => await readSource() !== before, 'undo write')
  }
  await select('m5-missing')
  assert((await tab.playwright.domSnapshot()).includes('Missing: Unavailable Example Font'), 'missing font status')
  await tab.playwright.getByRole('textbox', { name: 'Font family', exact: true }).press('Tab')
  await tab.playwright.getByRole('searchbox', { name: 'Search fonts', exact: true }).fill('nAnUm')
  await tab.playwright.getByRole('searchbox', { name: 'Search fonts', exact: true }).press('ArrowDown')
  assert(await readSource() === source, 'hover preview wrote source')
  await press('Cancel')
  assert(await readSource() === source, 'cancel changed source')
  results.push('font search / preview / cancel / missing: PASS')
  await select('m5-variable')
  await press('Edit text')
  await wait(async () => await tab.playwright.locator('[data-studio-text-id="m5-variable"]').getAttribute('contenteditable') === 'true', 'text edit mode')
  for (const language of ['Japanese', 'Chinese', 'Korean']) {
    await press(`Compose ${language}`)
    await wait(async () => (await tab.playwright.getByRole('status', { name: 'IME event result' }).innerText()).startsWith(`PASS ${language}`), `${language} composition`)
    const result = await tab.playwright.getByRole('status', { name: 'IME event result' }).innerText()
    assert(result.includes('intermediate=0; final=1'), 'IME transaction count')
    results.push(result)
    await undo()
    assert(await readSource() === source, `${language} undo did not restore bytes`)
  }
  assert(await readStyles() === styles, 'event fixture altered shared resources')
  return results
}
