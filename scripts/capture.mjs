/**
 * PATCHWORK — visual QA capture harness (NOT part of the app bundle).
 *
 * Drives headless Chrome over the DevTools Protocol using only Node built-ins
 * (no puppeteer/playwright): navigates the real app, exercises the real flows
 * against the mock backend, and saves screenshots to shots/.
 *
 * Usage: node scripts/capture.mjs [before|after]
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const TAG = process.argv[2] ?? 'after'
const OUT_DIR = fileURLToPath(new URL(`../shots/${TAG}/`, import.meta.url))
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const APP = 'http://localhost:5173'
const DEBUG_PORT = 9223

mkdirSync(OUT_DIR, { recursive: true })

const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  '--user-data-dir=/tmp/patchwork-chrome-profile',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' })

const cleanup = () => { try { chrome.kill() } catch { /* exit anyway */ } }
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(1))

async function waitFor(condition, timeoutMs, everyMs = 250) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return true
    await sleep(everyMs)
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}

let ws
let msgId = 0
const pending = new Map()

function send(method, params = {}, sessionId) {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, method })
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
}

async function main() {
  // Wait for the DevTools endpoint, then attach to a fresh page target.
  await waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      return r.ok
    } catch {
      return false
    }
  }, 15000)

  // Connect directly to the page target — no browser-level session needed.
  const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target')
  ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const entry = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`))
      else entry.resolve(msg.result)
    }
  }
  const sid = undefined

  await send('Page.enable', {}, sid)
  await send('Runtime.enable', {}, sid)

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sid)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed')
    return r.result?.value
  }

  const setViewport = (width, height, mobile = false) =>
    send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile }, sid)

  const navigate = async (url) => { await send('Page.navigate', { url }, sid); await sleep(1200) }

  const shot = async (name) => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' }, sid)
    writeFileSync(`${OUT_DIR}${name}.png`, Buffer.from(data, 'base64'))
    console.log(`saved ${TAG}/${name}.png`)
  }

  const clickButton = (label) =>
    evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.toLowerCase().includes(${JSON.stringify(label.toLowerCase())})); if (!b) throw new Error('button not found: ${label}'); b.click(); return true })()`)

  // Fill the brief through React's controlled-input contract.
  const fillBrief = () =>
    evaluate(`(() => {
      const ta = document.querySelector('textarea#description')
      if (!ta) throw new Error('brief textarea not found')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '500 custom ceramic mugs with a two-color logo print, matte black glaze, individual gift boxes, delivered to Austin TX')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)

  const waitHidden = (selector) => waitFor(async () => !(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)), 20000)
  const waitVisible = (selector) => waitFor(async () => !!(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)), 20000)
  const waitForClassGone = (cls) => waitFor(async () => !(await evaluate(`document.querySelector('.${cls}') !== null`)), 25000)

  // Desktop pass — 1440×900
  await setViewport(1440, 900)
  await navigate(APP)
  await sleep(1600) // entrance choreography
  await shot('01-request')

  await fillBrief()
  await clickButton('Assemble network')
  await waitVisible('[data-node-card]')
  await waitForClassGone('assembly-pending')
  await sleep(700)
  await shot('02-network-assembled')

  await clickButton('Simulate failure')
  await sleep(1600) // mid-disruption: victim flagged, downstream rippling, repair in flight
  await shot('03-network-disruption')
  await waitVisible('.card-status.ok')
  await sleep(600)
  await shot('04-network-repaired')

  // Route inspection: hover the first supplier card
  const rect = await evaluate(`(() => { const el = document.querySelector('[data-node-card]'); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x, y: rect.y }, sid)
  await sleep(600)
  await shot('05-route-inspection')
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 8, y: 8 }, sid)

  await clickButton('Proceed to checkout')
  await waitVisible('aside')
  await sleep(1200)
  await shot('06-checkout')

  await clickButton('Pay with')
  await waitFor(async () => evaluate(`document.body.innerText.includes('Confirmed')`), 20000) // redirect → auto-capture
  await sleep(1600)
  await shot('07-success')

  // Mobile pass — 390×844
  await setViewport(390, 844, true)
  await navigate(APP)
  await sleep(1600)
  await shot('08-request-mobile')

  await fillBrief()
  await clickButton('Assemble network')
  await waitVisible('[data-node-card]')
  await waitForClassGone('assembly-pending')
  await sleep(700)
  await shot('09-network-mobile')

  await clickButton('Proceed to checkout')
  await waitVisible('aside')
  await sleep(1200)
  await shot('10-checkout-mobile')

  await clickButton('Pay with')
  await waitFor(async () => evaluate(`document.body.innerText.includes('Confirmed')`), 20000)
  await sleep(1600)
  await shot('11-success-mobile')

  console.log('done')
  process.exit(0)
}

main().catch((err) => {
  console.error('capture failed:', err.message)
  process.exit(1)
})
