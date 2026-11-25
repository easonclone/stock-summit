import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';

const artifacts = resolve(process.env.STOCK_SUMMIT_SHOTS ?? 'test-results/v2');
const build = resolve(process.env.STOCK_SUMMIT_BUILD ?? 'dist');
await mkdir(artifacts, { recursive: true });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost').pathname;
  if (url === '/favicon.ico') { res.writeHead(204).end(); return; }
  if (!url.startsWith('/stock-summit/')) { res.writeHead(404).end(); return; }
  const path = url === '/stock-summit/' ? 'index.html' : url.slice('/stock-summit/'.length);
  try {
    res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : 'text/html');
    res.end(await readFile(join(build, path)));
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
async function key(name) {
  const codes = { Enter: ['Enter', 13], Escape: ['Escape', 27] };
  const [code, vk] = codes[name];
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await delay(60);
}
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
      touch: Array.from(document.querySelectorAll('.card-button,.alloc-button,.gold-button')).filter(el=>el.getClientRects().length).every(el=>el.getBoundingClientRect().height >= 44)
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
  // 開局先免費三選一王牌，選完才能交易。
  assert.match(await js('document.querySelector("dialog[open] #dialog-heading")?.textContent ?? ""'), /開局選一張王牌/);
  assert.equal(await js('document.querySelectorAll("dialog[open] .offer-card").length'), 3);
  if (width === 390) await screenshot('opening-joker-390');
  await click(on('offer-card') + '[data-value="0"]');
  await action('take');
  transitions.joker++;
  assert.equal(await js('document.querySelectorAll(".joker-row .card-button").length'), 1, '王牌列顯示一張王牌');
  await layout(width, height, true);
  await action('chart');
  assert.equal(await js('document.querySelectorAll("dialog[open] .chart polyline").length'), 4);
  await action('close-dialog');
  for (const hidden of ['無融資', '交易正常', '正常交易', '無避險', '融資', '借款', '利息', '追繳', '定存', '欠款', '路線', '手牌', '行動力']) assert(!(await js('document.querySelector("main").innerText')).includes(hidden), '主畫面不顯示 ' + hidden);
  assert.equal(await js('document.querySelectorAll(\'[data-act="alloc"]\').length'), 3, '三個配置按鈕');
  assert.equal(await js('document.querySelector(\'[data-act="alloc"][aria-pressed="true"]\').dataset.value'), 'half', '預設一半買股');
}

const transitions = { joker: 0, shop: 0, bought: 0, itemFull: 0, recovery: 0, skip: 0, effect: 0, personal: 0, show: 0 };
async function clearDialogs(replaceOne = false) {
  for (let n = 0; n < 6; n++) {
    if (await has('.theater')) {
      assert.match(await js('document.querySelector(".scene-banner").innerText'), /第 \d+ 日/);
      transitions.show++;
      await click('.theater [data-th="skip"]');
      assert(!(await has('.theater')), '事件劇場可略過');
    }
    const dialog = await js('document.querySelector("dialog[open]")?.className ?? ""');
    if (!dialog) {
      if (!(await has(on('daily-decline')))) return;
      transitions.itemFull++;
      assert(await has('[data-act="trade"]:disabled'), '滿手時先決定是否替換');
      if (replaceOne) {
        await action('daily-replace');
        replaceOne = false;
      } else await action('daily-decline');
      continue;
    }
    if (dialog.includes('dialog-recovery') && transitions.recovery === 0) await screenshot('recovery-320');
    const body = await js('document.querySelector("dialog").innerText');
    if (dialog.includes('dialog-recovery')) {
      assert.match(body, /身家歸零/);
      assert.match(body, /不用還/);
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
    } else if (dialog.includes('dialog-shop')) {
      transitions.shop++;
      assert(!(await has('.day-transition')), '換日演出等離開商店才播放');
      const shopDay = await js('Number(document.querySelector("[data-shop-day]").dataset.shopDay)');
      assert.match(await js('document.querySelector(".session-counter strong").textContent'), new RegExp(String(shopDay).padStart(2, '0')));
      assert.match(body, /商店/);
      assert.equal(await js('document.querySelectorAll("dialog .shop-card").length'), 5, '商店三張王牌加兩張道具');
      assert.equal(await js('document.querySelectorAll("dialog .shop-card .joker").length'), 3);
      const cash = () => js('Number(document.querySelector("[data-shop-cash]").textContent.replace(/[^\\d]/g, ""))');
      const before = await cash();
      // Buy the first shelf that needs no replacement and is affordable; the wallet must drop by exactly its price.
      const index = await js(`[...document.querySelectorAll("dialog .shop-card")].findIndex(b => b.querySelector(".shop-status").textContent === "買得起")`);
      if (index >= 0) {
        await click(on('shop-card') + `[data-value="${index}"]`);
        const price = await js('Number(document.querySelector("[data-act=buy]").textContent.replace(/[^\\d]/g, ""))');
        await action('buy');
        assert.equal(await cash(), before - price, '商店扣款等於售價');
        transitions.bought++;
      }
      await action('leave-shop');
    } else if (dialog.includes('dialog-offer')) {
      const heading = await js('document.querySelector("dialog #dialog-heading").textContent');
      const count = await js('document.querySelectorAll(".offer-card").length');
      if (count > 1) {
        await click(on('offer-card') + '[data-value="0"]');
        if (await has(on('replace'))) await action('replace');
        await action('take');
      } else {
        transitions.itemFull++;
        if (replaceOne) {
          await action('replace');
          await action('take');
          replaceOne = false;
        } else await action('decline');
      }
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
  const desktopOnly = process.argv.includes('--desktop-only');
  const viewports = desktopOnly ? [[1440, 900]] : [[320, 640], [360, 780], [390, 844], [430, 932], [1440, 900]];
  for (const [width, height] of viewports) {
    const mobile = width < 500;
    await openMarket(width, height, mobile, width === 320 ? 2 : 23, mobile);
    assert.equal(await js('document.querySelectorAll(".item-row button").length'), 3, '開局三張道具');
    assert(!(await has('[data-morning-item]')), '第 1 日不額外抽牌');
    assert.equal(await js('document.querySelectorAll(".timeline-day").length'), 15);
    assert.equal(await js('document.querySelectorAll(".timeline-day[data-shop]").length'), 4);
    const actionCard = on('item') + '[data-timing="action"]';
    const hasItem = await has(actionCard);
    if (hasItem) await click(actionCard);
    if (!mobile) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
      assert.equal(await js('document.querySelector('+JSON.stringify(pressed('alloc'))+')?.dataset.value'), 'all', '方向鍵切換配置');
    } else await click(on('alloc') + '[data-value="all"]');
    const card = await js('document.querySelector('+JSON.stringify(pressed('item'))+')?.dataset.value');
    assert.match(await js('document.querySelector(".alloc-section .preview").innerText'), /現金 \$0 · 股票 \$10,000/, '全部買股預覽');
    if (width === 390) {
      await resize(844, 390, true);
      await layout(844, 390);
      await resize(width, height, true);
    }
    assert.equal(await js('document.querySelector('+JSON.stringify(pressed('item'))+')?.dataset.value'), card);
    if (hasItem) {
      assert(await has('[data-item-status]'), '選道具後顯示今天的效果');
      if (width === 390) {
        await js('document.querySelector("[data-item-status]").scrollIntoView({block:"center"})');
        await screenshot('item-feedback-390');
      }
      await click(pressed('item'));
    }
    await layout(width, height, true);
    await trustedClick(on('trade'), mobile, false);
    if (await has(on('skip'))) {
      transitions.skip++;
      await action('skip');
    }
    await clearDialogs();
    assert.match(await js('document.querySelector(".session-counter strong").textContent'), /02/);
    assert.match(await js('document.querySelector("[data-morning-item]").textContent'), /今日抽到/);
    if (!mobile) {
      assert.match(await js('document.querySelector(".day-transition strong")?.textContent ?? ""'), /DAY 02/);
      await delay(680);
      await screenshot('day-transition-desktop');
    }
    await action('chart');
    assert(!(await has('.day-transition')), '可直接點擊跳過換日畫面');
    assert.equal(await js('document.querySelector("dialog[open] .chart polyline").getAttribute("points").split(" ").length'), 2);
    await action('close-dialog');
    assert(await has('.day-result'), '每日結算分項');
    await layout(width, height, true);

    if (width === 320 || !mobile) {
      const early = width === 320;
      for (let day = 2; day <= 15 && !(await has('main.settlement')); day++) {
        await clearDialogs(!early);
        if (await has('main.settlement')) break;
        if (await has(on('alloc'))) await click(on('alloc') + '[data-value="' + (early ? 'all' : ['half', 'cash', 'all'][day % 3]) + '"]');
        if (!mobile && await has('[data-act="trade"]')) {
          await js('document.querySelector(\'[data-act="trade"]\').focus()');
          await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 49 });
          await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 49 });
          assert(await has(on('skip')), '使用鍵盤空白鍵確認交易，第 '+day+' 日');
        } else await action('trade');
        for (let i = 0; i < 40 && await has(on('skip')); i++) await delay(25);
        await clearDialogs(!early);
        if (!early && await has('main.trading') && /06/.test(await js('document.querySelector(".session-counter strong").textContent'))) {
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
      await js('scrollTo(0, document.querySelector(".alloc-section").offsetTop - 15)');
      await layout(width, height, true);
      if (width === 390) { await screenshot('trading-390'); await js('scrollTo(0,0)'); await screenshot('market-390'); }
    }
    results.push({ width, height, mobile, fullRun: width === 320 || !mobile });
    console.error(width + ' px 已驗證');
  }
  // 王牌詳情、結算連鎖：全部買股連玩三天，結算列出股市與王牌步驟，加總等於當日變化。
  await openMarket(1440, 900, false, 6, true);
  await click(on('card-detail') + '[data-kind="joker"]');
  assert.match(await js('document.querySelector("dialog[open]").innerText'), /每天自動發動/);
  await action('close-dialog');
  for (let day = 1; day <= 3; day++) {
    await click(on('alloc') + '[data-value="all"]');
    await trustedClick(on('trade'), false, false);
    await clearDialogs();
    assert(!(await has('.day-transition')), '減少動態時略過換日畫面');
    const chain = await js(`(() => {
      const parse = text => Number(text.replace(/[^0-9−+-]/g, '').replace('−', '-'));
      const steps = [...document.querySelectorAll('.chain li b')].map(el => parse(el.textContent));
      return { sum: steps.reduce((a, b) => a + b, 0), net: parse(document.querySelector('.day-result header strong').textContent) };
    })()`);
    assert.equal(chain.sum, chain.net, '結算連鎖加總等於當日變化，第 ' + day + ' 日');
  }
  await js('scrollTo(0,0)');
  await screenshot('chain-desktop');
  await layout(1440, 900, true);

  if (desktopOnly) {
    // 讓固定種子的黑天鵝演出跑到特效，避免主流程略過劇場時漏驗 Canvas。
    await openMarket(1440, 900, false, 13, false);
    for (let day = 1; day <= 6; day++) {
      await clearDialogs();
      await action('trade');
      if (await has(on('skip'))) await action('skip');
      if (day === 6) {
        assert(await has('.theater.sev-extreme'), '黑天鵝事件劇場');
        for (let i = 0; i < 250 && !(await has('.theater-fx canvas')); i++) await delay(100);
        if (await has('.theater-fx canvas')) transitions.effect++;
      }
      await clearDialogs();
    }
  }

  if (!desktopOnly) {
    await openMarket(390, 844, true, 15, true);
    await action('trade');
    await clearDialogs();
    await click(on('alloc') + '[data-value="cash"]');
    const stockItem = await js(`[...document.querySelectorAll('[data-act="item"]')].find(el => ['trend', 'double', 'dividend'].includes(el.dataset.cardId))?.dataset.value ?? null`);
    if (stockItem !== null) {
      await click(on('item') + '[data-value="' + stockItem + '"]');
      assert.match(await js('document.querySelector("[data-item-status]").textContent'), /沒有股票/, '全留現金時說明道具不會多賺');
      assert.equal(await js('document.querySelector(\'[data-act="trade"]\').disabled'), true, '用不了的道具不能送出');
      await click(on('alloc') + '[data-value="half"]');
      assert.doesNotMatch(await js('document.querySelector("[data-item-status]").textContent'), /用不了/);
      await js('document.querySelector("[data-item-status]").scrollIntoView({block:"center"})');
      await screenshot('item-block-390');
      await click(pressed('item'));
    }
    await layout(390, 844, true);

    // 種子 13 的第 6 日固定是極端新聞（新聞排程只看種子），驗證全螢幕演出與略過。
    await openMarket(390, 844, true, 13, false);
    for (let day = 1; day <= 6; day++) {
      await clearDialogs();
      await action('trade');
      for (let i = 0; i < 40 && await has(on('skip')); i++) await delay(25);
      if (day === 3) {
        // 一般／重大新聞：Enter 先補完逐字，再進下一句；Esc 直接結束且結果不變。
        assert(await has('.theater'), '新聞日播放事件劇場');
        const worth = await js('document.querySelector(".hero-main strong").textContent');
        for (let i = 0; i < 40 && await js('document.querySelector(".theater")?.dataset.step') !== 'line'; i++) await delay(50);
        await key('Enter');
        assert.equal(await js('document.querySelector(".rpg-box").classList.contains("typing")'), false, 'Enter 補完當前句');
        await screenshot('theater-line-390');
        await key('Escape');
        assert(!(await has('.theater')), 'Esc 略過演出');
        assert.equal(await js('document.querySelector(".hero-main strong").textContent'), worth, '略過不影響結果');
      }
      if (day === 6) {
        assert(await has('.theater.sev-extreme'), '黑天鵝事件劇場');
        for (let i = 0; i < 250 && await js(`document.querySelector(".theater")?.dataset.step`) !== "results"; i++) {
          if (await has('.theater-fx canvas')) transitions.effect++;
          await delay(100);
        }
        assert.equal(await js('document.querySelector(".theater")?.dataset.step'), 'results', '自動播放到實際結算，不需逐句點擊');
        assert.equal(await js('document.querySelectorAll(".theater-results li").length'), 4);
        await screenshot('theater-results-390');
      }
      await clearDialogs();
    }
    assert(transitions.show > 0, '事件劇場可略過');
    // 快速演出：同一天的演出步驟較少；略過演出：不出現劇場。
    await action('settings');
    await js('(() => { const s = document.querySelector("[data-input=theater]"); s.value = "off"; s.dispatchEvent(new Event("change", { bubbles: true })); })()');
    await action('close-dialog');
    await clearDialogs();
    await action('trade');
    for (let i = 0; i < 40 && await has(on('skip')); i++) await delay(25);
    assert(!(await has('.theater')), '略過演出模式不播放');
    await js('localStorage.removeItem("stock-summit-theater")');

    // 新聞影響說明（沒有借款後，一般遊玩不會歸零；歸零與翻身由單元測試覆蓋）。
    await openMarket(320, 640, true, 7893, true);
    for (let day = 1; day <= 3; day++) {
      await click(on('alloc') + '[data-value="all"]');
      await action('trade');
      await clearDialogs();
    }
    await action('news');
    assert(await has('dialog[open] [data-market-impact]'));
    await screenshot('market-impact-320');
    await action('close-dialog');
  }
  assert(transitions.joker > 0, '開局選王牌');
  assert(transitions.shop > 0, '商店開門');
  assert(transitions.bought > 0, '商店購買');
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
