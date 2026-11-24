// 介面改版前後對照：以正式建置在多種寬度開局，截取首屏、整頁與第 3 日市場事件後畫面，並輸出版面量測。
// 用法：npm run build && node scripts/capture-ux.mjs <輸出名稱>
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const label = process.argv[2] ?? 'ux';
const out = resolve('test-results', label);
await mkdir(out, { recursive: true });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  if (!url.startsWith('/stock-summit/')) { res.writeHead(404).end(); return; }
  const path = url === '/stock-summit/' ? 'index.html' : url.slice('/stock-summit/'.length);
  try {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(join('dist', path)));
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const profile = await mkdtemp(join(tmpdir(), 'stock-summit-ux-'));
const chrome = spawn(process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--no-first-run', '--user-data-dir=' + profile, 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const pending = new Map();
const errors = [];
let buffer = '';
let sequence = 0;
let sessionId;
const delay = ms => new Promise(done => setTimeout(done, ms));
chrome.stdio[4].setEncoding('utf8');
chrome.stdio[4].on('data', data => {
  buffer += data;
  let end;
  while ((end = buffer.indexOf('\0')) >= 0) {
    const message = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
  }
});
function send(method, params = {}, session = sessionId) {
  const id = ++sequence;
  return new Promise((done, fail) => {
    pending.set(id, { resolve: done, reject: fail });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }) + '\0');
  });
}
async function js(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function shot(name, full = false) {
  const params = { format: 'png', fromSurface: true };
  if (full) {
    const { cssContentSize } = await send('Page.getLayoutMetrics');
    Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 } });
  }
  const result = await send('Page.captureScreenshot', params);
  await writeFile(join(out, name + '.png'), Buffer.from(result.data, 'base64'));
}
async function waitFor(selector) {
  for (let n = 0; n < 100; n++) {
    if (await js(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await delay(40);
  }
  throw Error('找不到 ' + selector);
}
/** Clears draw / draft dialogs by taking the first card (replacing the first slot when the hand is full). */
async function clearDialogs() {
  for (let n = 0; n < 6; n++) {
    const open = await js('Boolean(document.querySelector("dialog[open]"))');
    if (!open) return;
    await js(`(() => {
      const d = document.querySelector('dialog[open]');
      const pick = (s) => { const el = d.querySelector(s); if (el && !el.disabled) { el.click(); return true; } return false; };
      pick('[data-act="offer-card"]'); pick('[data-act="replace"]');
      pick('[data-act="take"]') || pick('[data-act="recover"]') || pick('[data-act="decline"]') || pick('[data-act="close-dialog"]');
    })()`);
    await delay(120);
  }
}
async function playDay() {
  await js('document.querySelector(".news-show button")?.click()');
  await clearDialogs();
  await js('document.querySelector(\'[data-act="lane"]\')?.click()');
  await delay(60);
  await js('document.querySelector(\'[data-act="trade"]\')?.click()');
  await delay(900);
  await js('document.querySelector(\'[data-act="skip"]\')?.click()');
  await delay(200);
  if (await js('Boolean(document.querySelector(".news-show"))')) { extremeShots++; await shot(`${currentWidth}-news-show-${extremeShots}`); }
  await js('document.querySelector(".news-show button")?.click()');
}
let extremeShots = 0;
let currentWidth = 0;
/** How much of the decision UI fits the first screen, and how tall the page is. */
const metrics = () => js(`(() => {
  const top = sel => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().top + scrollY) : null; };
  const zeroes = [...document.querySelectorAll('main *')].filter(el => el.children.length === 0 && /^(\\$0|0%|◆ 0|×0\\.00|無融資|交易正常)$/.test(el.textContent.trim()) && el.getClientRects().length).length;
  return { viewport: innerHeight, page: document.documentElement.scrollHeight, screens: +(document.documentElement.scrollHeight / innerHeight).toFixed(2),
    scrollWidth: document.documentElement.scrollWidth, handTop: top('[data-act="card"]'), actionTop: top('[data-act="lane"]'),
    confirmVisible: (() => { const b = document.querySelector('[data-act="trade"]'); if (!b) return false; const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })(),
    zeroFields: zeroes, words: document.querySelector('main')?.innerText.replace(/\\s+/g, '').length ?? 0 };
})()`);

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined));
await send('Runtime.enable');
await send('Page.enable');
const report = {};
for (const [width, height] of [[320, 640], [360, 780], [390, 844], [430, 932], [1440, 900]]) {
  const mobile = width < 800;
  currentWidth = width;
  extremeShots = 0;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/stock-summit/?seed=42` });
  await waitFor('[data-act="start"]');
  await js('document.querySelector(\'[data-act="start"]\').click()');
  await waitFor('[data-act="trade"]');
  await clearDialogs();
  await delay(150);
  report[width] = { start: await metrics() };
  await shot(`${width}-first-screen`);
  await shot(`${width}-full`, true);
  await js('document.querySelector(\'[data-act="card"]\')?.click()');
  await js('document.querySelector(\'[data-act="lane"]\')?.click()');
  await delay(120);
  await shot(`${width}-selected`, true);
  for (let day = 0; day < 3; day++) await playDay();
  await delay(400);
  await clearDialogs();
  await js('scrollTo(0, 0)');
  report[width].afterEvent = await metrics();
  await shot(`${width}-after-event`);
  for (let day = 3; day < 8; day++) await playDay();
  await clearDialogs();
  await js('scrollTo(0, 0)');
  await delay(300);
  await shot(`${width}-day-${8}`);
}
report.errors = errors;
await writeFile(join(out, 'metrics.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
chrome.kill();
server.close();
