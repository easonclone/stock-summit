// 攻防演出驗收：以開發伺服器開啟 fx-lab.html，逐一播放真實結算出的攻防情境，
// 在桌機與手機寬度截取命中瞬間與延遲傷害條，並檢查畫面浮字與結算紀錄一致、未命中沒有假傷害。
// 用法：node scripts/capture-fx.mjs   （輸出到 test-results/fx/）
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';

const out = resolve('test-results', 'fx');
await mkdir(out, { recursive: true });
const vite = await createServer({ server: { port: 5199, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
await vite.listen();
const base = vite.resolvedUrls.local[0].replace(/\/$/, '');
const profile = await mkdtemp(join(tmpdir(), 'stock-summit-fx-'));
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
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
  }
});
function send(method, params = {}, session = sessionId) {
  const id = ++sequence;
  return new Promise((done, reject) => {
    pending.set(id, { resolve: done, reject });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }) + '\0');
  });
}
async function js(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function shot(name, selector) {
  const clip = selector ? await js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 36), width: r.width + 8, height: r.height + 40, scale: 1 }; })()`) : undefined;
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, ...(clip ? { clip } : {}) });
  await writeFile(join(out, name + '.png'), Buffer.from(result.data, 'base64'));
  return name + '.png';
}

const cases = [
  ['snipe', '主力狙擊命中'], ['rush', '空頭突襲命中'], ['double', '雙重打擊造成重擊'], ['brawl', '股市大混戰同時攻擊三人'],
  ['shield', '護盾成功格擋'], ['shatter', '破盾一擊'], ['mirror', '反擊鏡'], ['raid', '資金掠奪'], ['jokers', '多張王牌連鎖'],
  ['market_up', '市場大漲'], ['market_down', '市場大跌'], ['miss', '攻擊未命中（對手沒有股票）']
];
const viewports = [['desktop', 1280, 800, false], ['mobile', 390, 844, true]];
const moneyText = amount => (amount < 0 ? '−' : '') + '$' + Math.abs(amount).toLocaleString('en-US');
const keyMoment = plan => {
  const key = plan.events.find(event => ['attack', 'raid', 'shatter', 'reflect', 'defense'].includes(event.kind))
    ?? plan.events.filter(event => event.kind === 'joker').at(-1) ?? plan.events[0];
  return key?.at ?? 0;
};

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
  await send('Page.enable');
  await send('Runtime.enable');
  const report = [];
  for (const [key, label] of cases) {
    for (const [device, width, height, mobile] of viewports) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile });
      for (const reduced of device === 'mobile' && ['double', 'brawl', 'mirror'].includes(key) ? [false, true] : [false]) {
        await send('Page.navigate', { url: `${base}/fx-lab.html?case=${key}${reduced ? '&reduced' : ''}` });
        for (let n = 0; n < 200 && !(await js('document.body?.dataset.ready === "true"')); n++) await delay(25);
        const plan = await js('window.__fx.plan');
        const records = await js('({ attacks: window.__fx.report.attacks, misses: window.__fx.report.misses })');
        const tag = `${key}-${device}${reduced ? '-reduced' : ''}`;
        const area = key === 'jokers' ? null : '.arena';
        const frames = [];
        const startedAt = Date.now();
        await js('window.__fx.start()');
        if (reduced) {
          await delay(80);
          frames.push(await shot(tag, area));
        } else {
          const moment = keyMoment(plan);
          for (const [offset, suffix] of [[110, 'hit'], [420, 'trail']]) {
            await delay(Math.max(0, moment + offset - (Date.now() - startedAt)));
            frames.push(await shot(`${tag}-${suffix}`, area));
          }
          await delay(Math.max(0, plan.span + 900 - (Date.now() - startedAt)));
        }
        const seen = await js('window.__fx.seen');
        const shown = seen.join(' | ');
        // Every number on screen must be a recorded amount; misses must not show damage.
        for (const event of plan.events) {
          if (event.kind === 'attack' || event.kind === 'raid') assert(shown.includes(moneyText(-event.amount)), `${tag}：缺少傷害 ${event.amount}`);
          if (event.kind === 'shatter') assert(shown.includes('破盾'), `${tag}：缺少破盾`);
          if (event.kind === 'reflect') assert(shown.includes('反擊鏡') && shown.includes(moneyText(-event.amount)), `${tag}：缺少反擊`);
          if (event.kind === 'defense') assert(shown.includes(moneyText(event.amount)), `${tag}：缺少格擋金額`);
        }
        if (key === 'miss') {
          assert.equal(records.attacks.length, 0);
          assert(shown.includes('未命中') && shown.includes('對手沒有股票'), `${tag}：缺少未命中`);
          assert(!seen.some(text => /−\$/.test(text)), `${tag}：未命中不得顯示傷害`);
        }
        const bars = await js(`[...document.querySelectorAll('[data-fighter]')].map(f => ({ id: f.dataset.fighter, worth: f.querySelector('.worth').textContent }))`);
        for (const seat of plan.seats) assert.equal(bars.find(bar => bar.id === seat.id).worth, moneyText(seat.close), `${tag}：${seat.id} 結束時財富條數字應等於收盤`);
        report.push({ key, label, device, reduced, frames, attacks: records.attacks, misses: records.misses, floats: seen });
      }
    }
  }
  await writeFile(join(out, 'report.json'), JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report.map(item => ({ case: item.key, device: item.device, reduced: item.reduced, floats: item.floats })), null, 1));
} finally {
  chrome.kill();
  await vite.close();
}
