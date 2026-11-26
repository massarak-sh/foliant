/* End-to-end check of the real app. Run: npm run build && xvfb-run -a node tests/e2e/smoke.cjs
 * Uses Playwright's Electron support. Set SHOTS=dir to save screenshots. */
const { _electron: electron } = require('playwright')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '../..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foliant-e2e-'))
const userData = path.join(tmp, 'profile')
const projectsDir = path.join(tmp, 'projects')
const shots = process.env.SHOTS
const electronBin = require(path.join(root, 'node_modules/electron'))

async function launch() {
  const app = await electron.launch({
    executablePath: electronBin,
    args: [root, '--no-sandbox'],
    env: { ...process.env, FOLIANT_USER_DATA: userData, ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  page.on('pageerror', (e) => console.error('PAGE ERROR', e))
  page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()))
  await page.setViewportSize({ width: 1400, height: 880 }).catch(() => {})
  return { app, page }
}

const step = (s) => console.log('•', s)
const shot = async (page, name) => shots && page.screenshot({ path: path.join(shots, name + '.png') })

async function waitSaved(page) {
  try {
    await page.waitForFunction(() => document.querySelector('[data-testid=save-status]')?.textContent?.trim().startsWith('Saved'), null, { timeout: 10000 })
  } catch (e) {
    console.error('save status:', await page.textContent('[data-testid=save-status]').catch(() => '?'))
    throw e
  }
}

;(async () => {
  let { app, page } = await launch()

  step('create a project')
  await page.click('[data-testid=new-project]')
  await page.fill('[data-testid=new-title]', 'The Long Winter')
  await page.fill('[data-testid=new-dir]', projectsDir)
  await page.click('[data-testid=create-project]')
  await page.waitForSelector('[data-testid=editor]')
  const projectPath = path.join(projectsDir, 'The Long Winter.foliant')
  assert.ok(fs.existsSync(path.join(projectPath, 'foliant.json')))

  step('type in Scene 1 and check it reaches the disk')
  await page.click('[data-testid=editor]')
  await page.keyboard.type('The snow came early that year, and it did not stop.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Mara watched it from the kitchen window.')
  await waitSaved(page)
  const binder = JSON.parse(fs.readFileSync(path.join(projectPath, 'binder.json'), 'utf8'))
  const scene1 = binder.manuscript[0].children[0].id
  const doc = JSON.parse(fs.readFileSync(path.join(projectPath, 'docs', scene1 + '.json'), 'utf8'))
  assert.equal(doc.words, 18)
  assert.match(await page.textContent('[data-testid=doc-count]'), /18 words/)
  assert.match(await page.textContent('[data-testid=today-count]'), /\+18/)

  step('formatting: italic')
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Control+i')
  await page.keyboard.press('End')
  await waitSaved(page)

  step('take a snapshot (Ctrl+5), edit, compare and restore')
  await page.keyboard.press('Control+5')
  await page.waitForSelector('[data-testid=snap-list] li')
  await page.click('[data-testid=editor]')
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('She was certain the road would close by morning.')
  await waitSaved(page)
  await page.click('[data-testid=snap-compare]')
  await page.waitForSelector('[data-testid=compare-modal] .ins')
  await shot(page, '3-compare')
  await page.keyboard.press('Escape')
  await page.click('[data-testid=snap-restore]')
  await page.click('[data-testid=confirm-restore]')
  await page.waitForFunction(() => !document.querySelector('[data-testid=editor]').textContent.includes('road would close'))
  // A safety snapshot of the current text is made before restoring.
  await page.waitForFunction(() => document.querySelectorAll('[data-testid=snap-list] li').length === 2)

  step('add a scene, rename it, write in it')
  await page.click('[data-testid=add-scene]')
  await page.keyboard.type('The Letter')
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-testid="binder-The Letter"]')
  await page.click('[data-testid=editor]')
  await page.keyboard.type('The letter arrived on a Tuesday, which was wrong. Letters never came on Tuesdays.')
  await waitSaved(page)

  step('add a chapter, turn it into a part, move the scene into it')
  await page.click('[data-testid=add-chapter]')
  await page.keyboard.type('Interlude')
  await page.keyboard.press('Enter')
  await page.click('[data-testid="binder-Interlude"]', { button: 'right' })
  await page.click('[data-testid=kind-section]')
  await page.dragAndDrop('[data-testid="binder-The Letter"]', '[data-testid="binder-Interlude"]')
  await page.waitForTimeout(300)
  const b2 = JSON.parse(fs.readFileSync(path.join(projectPath, 'binder.json'), 'utf8'))
  const interlude = b2.manuscript.find((i) => i.title === 'Interlude')
  assert.equal(interlude.kind, 'section')
  assert.equal(interlude.children[0]?.title, 'The Letter', 'scene was moved inside')

  step('open a scene as quick reference')
  await page.click('[data-testid="binder-The Letter"]')
  await page.click('[data-testid="binder-Scene 1"]', { button: 'right' })
  await page.click('text=Open as quick reference')
  await page.waitForSelector('.ref-text >> text=snow came early')
  await shot(page, '1-writing')
  await page.click('button:has-text("Snapshots")')

  step('settings dialog')
  await page.click('[data-testid=open-settings]')
  await shot(page, '4-settings')
  await page.click('text=Cancel')

  step('close the window right after typing: the last words must be saved')
  await page.click('[data-testid="binder-Scene 1"]')
  await page.click('[data-testid=editor]')
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' LASTWORDS')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await app.waitForEvent('close', { timeout: 15000 })
  let d1 = fs.readFileSync(path.join(projectPath, 'docs', scene1 + '.json'), 'utf8')
  assert.ok(d1.includes('LASTWORDS'), 'text typed just before closing was saved')

  step('reopen from the recent list')
  ;({ app, page } = await launch())
  await page.click('text=The Long Winter')
  await page.waitForSelector('[data-testid=editor]')
  await page.waitForFunction(() => document.querySelector('[data-testid=editor]').textContent.includes('LASTWORDS'))
  await shot(page, '2-reopened')

  step('crash: kill the app mid-typing; edits must be recovered')
  await page.click('[data-testid=editor]')
  await page.keyboard.press('Control+End')
  await page.keyboard.type(' CRASHWORDS')
  await page.waitForTimeout(80) // less than the save delay: only the emergency copy has it
  const pid = app.process().pid
  process.kill(pid, 'SIGKILL')
  await new Promise((r) => setTimeout(r, 800))
  ;({ app, page } = await launch())
  await page.click('text=The Long Winter')
  await page.waitForSelector('[data-testid=editor]')
  await page.waitForSelector('[data-testid=recovered-banner]', { timeout: 10000 })
  d1 = fs.readFileSync(path.join(projectPath, 'docs', scene1 + '.json'), 'utf8')
  assert.ok(d1.includes('CRASHWORDS'), 'text typed right before a crash was recovered')
  await shot(page, '5-recovered')
  await app.close()

  console.log('\nAll end-to-end checks passed.')
  fs.rmSync(tmp, { recursive: true, force: true })
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
