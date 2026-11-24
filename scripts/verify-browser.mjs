import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const artifacts = resolve('test-results/v2');
await mkdir(artifacts, { recursive: true });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  if (url === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (!url.startsWith('/stock-summit/')) { res.writeHead(404).end(); return; }
  const path = url === '/stock-summit/' ? 'index.html' : url.slice('/stock-summit/'.length);
  try {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(await readFile(join('dist', path)));
  } catch {
    res.writeHead(404).end();
  }
}).listen(0, '127.0.0.1');
await once(server, 'listening');
const profile = await mkdtemp(join(tmpdir(), 'stock-summit-chrome-'));
const chromePath = process.env.CHROME_PATH ?? (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium');
const chrome = spawn(chromePath, [
  '--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--user-data-dir=' + profile, 'about:blank'
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
const pending = new Map();
const errors = [];
let buffer = '';
let sequence = 0;
let sessionId;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(message.params.type)) errors.push(message.params.args.map(arg => arg.value ?? arg.description).join(' '));
  }
});
chrome.on('error', error => pending.forEach(request => request.reject(error)));
chrome.on('exit', () => pending.forEach(request => request.reject(new Error('Chrome 已結束'))));
function send(method, params = {}, session = sessionId) {
  const id = ++sequence;
  if (chrome.exitCode !== null) return Promise.reject(new Error('Chrome 已結束'));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }) + '\0');
  });
}
async function js(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
const on = act => '[data-act="'+act+'"]';
const pressed = act => on(act) + '[aria-pressed="true"]';
const has = selector => js('Boolean(document.querySelector(' + JSON.stringify(selector) + '))');
async function waitFor(selector) {
  for (let n = 0; n < 80; n++) {
    if (await has(selector)) return;
    await delay(35);
  }
  throw Error('找不到 ' + selector);
}
async function click(selector) {
  assert.equal(await js('(()=>{const el=document.querySelector(' + JSON.stringify(selector) + ');if(!el||el.disabled)return false;el.click();return true})()'), true, selector);
}
const action = act => click(on(act));
const resize = (width, height, mobile) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile,
  screenWidth: width, screenHeight: height, screenOrientation: { angle: width > height ? 90 : 0, type: width > height ? 'landscapePrimary' : 'portraitPrimary' } });
async function trustedClick(selector, touch, scroll = true) {
  const point = await js('(()=>{const el=document.querySelector(' + JSON.stringify(selector) + ');' +
    (scroll ? 'el.scrollIntoView({block:"center"});' : '') + 'const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  assert.equal(await js('document.elementFromPoint('+point.x+','+point.y+')?.closest('+JSON.stringify(selector)+')!==null'), true, '按鈕可由瀏覽器命中');
  if (touch) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
}
async function screenshot(name) {
  const result = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(join(artifacts, name + '.png'), Buffer.from(result.data, 'base64'));
}
async function layout(width, height, dock = false) {
  const dims = await js(`(() => {
    const trade = document.querySelector('[data-act="trade"]');
    const rect = trade?.getBoundingClientRect();
    const ctr = rect && document.elementFromPoint(rect.x + rect.width/2,rect.y + rect.height/2);
    return {
      width: innerWidth, doc: document.documentElement.scrollWidth, body: document.body.scrollWidth,
      dock: rect && rect.top >= 0 && rect.bottom <= innerHeight && (ctr === trade || trade.contains(ctr)),
      touch: Array.from(document.querySelectorAll('.hand-card,.action-tile,.gold-button')).filter(el=>el.getClientRects().length).every(el=>el.getBoundingClientRect().height >= 44)
    };
  })()`);
  assert.equal(dims.width, width);
  assert.equal(dims.doc, width, `document scrollWidth @${width}`);
  assert.equal(dims.body, width, `body scrollWidth @${width}`);
  assert(dims.touch, `主要點擊尺寸 @${width}`);
  if (dock) assert(dims.dock, `固定確認列應可點擊 @${width}×${height}`);
}
async function openMarket(width, height, mobile, seed, reduced) {
  await resize(width, height, mobile);
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/stock-summit/?seed=' + seed });
  await waitFor(on('start'));
  await layout(width, height);
  await trustedClick(on('start'), mobile);
  await waitFor('main.trading');
  await layout(width, height, true);
  assert.equal(await js('document.querySelectorAll(".chart polyline").length'), 4);
}

const transitions = { draw: 0, draft: 0, liquidation: 0, recovery: 0, skip: 0, effect: 0, personal: 0 };
async function clearDialogs(replaceOne = false) {
  for (let n = 0; n < 6; n++) {
    const dialog = await js('document.querySelector("dialog[open]")?.className ?? ""');
    if (!dialog) return;
    const body = await js('document.querySelector("dialog").innerText');
    const sold = body.match(/部位處分金額\s+\$([\d,]+)/);
    if (sold && Number(sold[1].replaceAll(',', '')) > 0) transitions.liquidation++;
    if (dialog.includes('dialog-recovery')) {
      assert.match(body, /宣告破產/);
      assert.match(body, /收盤應付重整費/);
      if (transitions.recovery === 0) await screenshot('recovery-320');
      transitions.recovery++;
      await action('recover');
    } else if (dialog.includes('dialog-crisis')) {
      if (await has(on('personal'))) {
        await action('personal');
        assert.match(await js('document.querySelector("main h1").textContent'), /個人結算/);
        await action('spectate');
        transitions.personal++;
      } else {
        await action('close-dialog');
      }
    } else if (dialog.includes('dialog-offer')) {
      const draft = body.includes('三選一');
      if (draft) {
        transitions.draft++;
        assert.equal(await js('document.querySelectorAll(".offer-card").length'), 3);
      } else transitions.draw++;
      if (draft) {
        await action('offer-card');
        if (await has(on('replace'))) await action('replace');
        await action('take');
      } else if (replaceOne) {
        await action('replace');
        await action('take');
        replaceOne = false;
      } else await action('decline');
    } else throw Error('未預期的對話框 ' + dialog);
  }
}

try {
  const version = await send('Browser.getVersion', {}, null);
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, null);
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, null));
  await send('Page.enable');
  await send('Runtime.enable');
  const results = [];
  for (const [width, height] of [[320, 640], [360, 780], [390, 844], [430, 932], [1440, 900]]) {
    const mobile = width < 500;
    await openMarket(width, height, mobile, width === 320 ? 2 : 23, mobile);
    await action('card');
    if (!mobile) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
      assert(await has(pressed('lane')));
    } else await action('lane');
    const card = await js('document.querySelector('+JSON.stringify(pressed('card'))+')?.dataset.value');
    const lane = await js('document.querySelector('+JSON.stringify(pressed('lane'))+')?.dataset.value');
    await action('map');
    assert.equal(await js('document.querySelectorAll(".map-row").length'), 15);
    assert.equal(await js('document.querySelector("dialog").scrollWidth === document.querySelector("dialog").clientWidth'), true);
    if (width === 390) {
      await screenshot('map-390');
      await resize(844, 390, true);
      await layout(844, 390);
      await resize(width, height, true);
    }
    await action('close-dialog');
    assert.equal(await js('document.querySelector('+JSON.stringify(pressed('card'))+')?.dataset.value'), card);
    assert.equal(await js('document.querySelector('+JSON.stringify(pressed('lane'))+')?.dataset.value'), lane);
    assert(await has('[data-card-status]'));
    if (width === 390) {
      await js('document.querySelector("[data-card-status]").scrollIntoView({block:"center"})');
      await screenshot('card-feedback-390');
    }
    await click(pressed('card'));
    await layout(width, height, true);
    await trustedClick(on('trade'), mobile, false);
    if (await has(on('skip'))) {
      transitions.skip++;
      await action('skip');
    }
    await clearDialogs();
    assert.match(await js('document.querySelector(".session-counter strong").textContent'), /02/);
    assert.equal(await js('document.querySelector(".chart polyline").getAttribute("points").split(" ").length'), 2);
    await layout(width, height, true);

    if (width === 320 || !mobile) {
      const early = width === 320;
      for (let day = 2; day <= 15 && !(await has('main.settlement')); day++) {
        await clearDialogs(!early);
        if (await has('main.settlement')) break;
        const next = await js(`Array.from(document.querySelectorAll('${on('lane')}')).find(el=>el.dataset.kind === '${early ? 'margin' : 'steady'}')?.dataset.value`);
        if (await has(on('lane'))) await click(next == null ? on('lane') : on('lane')+'[data-value="'+next+'"]');
        if (!mobile && await has('[data-act="trade"]')) {
          await js('document.querySelector(\'[data-act="trade"]\').focus()');
          await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 49 });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 49 });
          assert(await has(on('skip')), '使用鍵盤空白鍵確認交易，第 '+day+' 日');
        } else await action('trade');
        if (await has(on('skip'))) await delay(280);
        if (!mobile && await has('.market-strip.market-flash.major, .market-strip.market-flash.extreme')) {
          for (let i = 0; i < 20 && !(await has('.market-art canvas')); i++) await delay(25);
          if (await has('.market-art canvas')) transitions.effect++;
        }
        await clearDialogs(!early);
        if (!early && await has('main.trading') && /06/.test(await js('document.querySelector(".session-counter strong").textContent'))) {
          if (await has(on('lane'))) await action('lane');
          await js('scrollTo(0,0)');
          await screenshot('trading-desktop');
        }
      }
      await clearDialogs();
      assert.match(await js('document.querySelector(".report-hero").innerText'), /已結算 15 日/);
      assert.equal(await js('document.querySelectorAll(".report-row").length'), 4);
      await layout(width, height);
      if (width === 320) await screenshot('settlement-320');
      else {
        await screenshot('settlement-desktop');
        await action('share');
        await delay(150);
        assert.equal(await js('Boolean(document.querySelector("dialog[open] textarea")) || document.querySelector("#announce").textContent.includes("已複製")'), true);
        if (await has('dialog[open]')) await action('close-dialog');
        const previous = await js('new URL(location.href).searchParams.get("seed")');
        await action('replay');
        assert.equal(await js('new URL(location.href).searchParams.get("seed")'), previous);
        await openMarket(width, height, false, 23, true);
      }
    } else {
      await action('lane');
      await js('scrollTo(0, document.querySelector(".chart").offsetTop - 15)');
      await layout(width, height, true);
      if (width === 390) { await screenshot('trading-390'); await js('scrollTo(0,0)'); await screenshot('market-390'); }
    }
    results.push({ width, height, mobile, fullRun: width === 320 || !mobile });
    console.error(width + ' px 已驗證');
  }
  await openMarket(320, 640, true, 469, true);
  const earlyRecovery = transitions.recovery;
  for (let day = 1; day <= 15 && !(await has('main.settlement')); day++) {
    const preferences = transitions.recovery > earlyRecovery ? ['steady', 'mystery', 'dividend'] : ['margin', 'steady', 'mystery'];
    if (await has(on('lane'))) {
      const available = await js(`Array.from(document.querySelectorAll('${on('lane')}')).map(el=>({name:el.dataset.kind,lane:el.dataset.value}))`);
      const action = preferences.map(name=>available.find(node=>node.name===name)).find(Boolean) ?? available[0];
      await click(on('lane')+'[data-value="'+action.lane+'"]');
    }
    await action('trade');
    await clearDialogs();
    if (await has('.spectator')) await layout(320, 640, true);
  }
  assert(await has('main.settlement'), '觀戰能到收盤');
  assert(transitions.personal > 0, '手機出局、個人結算與返回觀戰');
  assert(transitions.recovery > 0, '手機破產重整路徑');
  assert(transitions.liquidation > 0, '強制平倉明細');
  assert(transitions.draw > 0, '滿手抽卡替換');
  assert(transitions.skip > 0, '略過動畫');
  assert(transitions.effect > 0, 'Phaser 市場特效');
  assert.deepEqual(errors, [], '瀏覽器例外與警告');
  console.log(JSON.stringify({ version: version.product, results, transitions, errors }, null, 2));
} finally {
  if (chrome.exitCode === null) {
    const closed = once(chrome, 'close');
    await send('Browser.close', {}, null).catch(() => {});
    chrome.kill();
    await closed.catch(() => {});
  }
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
