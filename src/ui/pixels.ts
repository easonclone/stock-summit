import type { FinancialConfig, InvestorCharacter } from '../config/financial-settings';
import { drawHDCard } from './hd-art';
import { drawInvestorArt } from './investor-art';
import { drawInvestorPortrait, drawInvestorSprite } from './investor-sprites';

type PixelIcon = FinancialConfig['jokers'][number]['icon'];
export type SystemIcon = PixelIcon | 'shop' | 'help' | 'settings' | 'news' | 'target' | 'mirror';

export type Pixel = (color: string, x: number, y: number, width: number, height: number) => void;

export function mixColor(first: string, second: string, weight: number) {
  const a = Number.parseInt(first.slice(1), 16);
  const b = Number.parseInt(second.slice(1), 16);
  const channels = [16, 8, 0].map(shift => Math.round(((a >> shift) & 255) * (1 - weight) + ((b >> shift) & 255) * weight));
  return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
}

/** 裁出臉部與上身，劇場和排行榜也能看清角色特徵。 */
export function portrait(canvas: HTMLCanvasElement, character: InvestorCharacter) {
  const size = 128;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = mixColor(character.color, '#131925', .8);
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#0b152663';
  ctx.fillRect(0, size - 10, size, 10);
  ctx.fillStyle = mixColor(character.color, '#131925', .72);
  ctx.fillRect(0, 4, size, 1);
  if (!drawInvestorPortrait(ctx, character.spriteKey, canvas.width)) {
    drawInvestorArt((color, x, y, w, h) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor(((character.spriteKey === 'uncle' ? 48 - x - w : x) - 6) * 1.75), Math.floor((y + 1) * 1.75), Math.ceil(w * 1.75), Math.ceil(h * 1.75));
    }, character.spriteKey);
  }
}

const icons: Record<SystemIcon, string[]> = {
  shop: ['0111110','1111111','1010101','0111110','0101010','0111110'],
  help: ['0011100','0100010','0000110','0001000','0000000','0001000'],
  settings: ['0010100','1111111','0110110','0110110','1111111','0010100'],
  news: ['0111110','0100010','0111110','0101010','0110110','0111110'],
  target: ['0011100','0101010','1110111','0101010','0011100','0000000'],
  mirror: ['0011100','0111110','0111110','0011100','0001000','0001000'],
  shield: ['0111110','0100010','0111010','0100010','0010100','0001000'],
  rocket: ['0011100','0011100','0010100','0111110','0101010','0001000'],
  short: ['1111111','1111111','0111110','0011100','0011100','0001000'],
  eye: ['0011100','0100010','1011101','1010101','0100010','0011100'],
  bolt: ['0011100','0111000','1111110','0011110','0011100','0110000'],
  anchor: ['0011100','0010100','0011100','0001000','1001001','0111110'],
  cash: ['0011100','0110000','0011100','0000110','0111000','0001000'],
  chart: ['0100010','1110010','1110111','0100111','0100010','0000010'],
  bull: ['1000001','1100011','1111111','0111110','0011100','0011100'],
  bear: ['1100011','1111111','1101011','1111111','0111110','0011100'],
  bank: ['0001000','0011100','0111110','0101010','0101010','1111111'],
  up: ['0001000','0011100','0111110','1111111','0011100','0011100'],
  down: ['0011100','0011100','1111111','0111110','0011100','0001000'],
  bills: ['0111110','1111111','1001001','1011101','1001001','1111111'],
  halt: ['0111110','1101011','1101011','1101011','1101011','0111110'],
  gem: ['0111110','1101011','1111111','0111110','0011100','0001000'],
  crown: ['1001001','1101011','1111111','1111111','1000001','1111111'],
  dice: ['1111111','1011101','1111111','1101011','1111111','1011101'],
  fire: ['0001000','0011000','0011100','0111110','1110111','0111110'],
  gift: ['0110110','1111111','1001001','1111111','1001001','1111111']
};

export function iconMarkup(icon: SystemIcon, color: string) {
  return `<canvas class="pixel-icon" data-icon="${icon}" data-color="${color}" width="32" height="32" aria-hidden="true"></canvas>`;
}

export function drawIcon(canvas: HTMLCanvasElement, icon: SystemIcon, color: string) {
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const cells = icons[icon];
  if (!cells) return;
  ctx.fillStyle = '#101a2b';
  ctx.fillRect(3, 6, 26, 20);
  ctx.fillRect(6, 3, 20, 26);
  ctx.fillStyle = mixColor(color, '#131925', .74);
  ctx.fillRect(5, 7, 22, 18);
  const shadow = mixColor(color, '#0c1223', .52);
  const bright = mixColor(color, '#ffffff', .48);
  cells.forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell !== '1') return;
    const left = 5 + x * 3;
    const top = 6 + y * 3;
    ctx.fillStyle = shadow;
    ctx.fillRect(left + 1, top + 2, 3, 3);
    ctx.fillStyle = color;
    ctx.fillRect(left, top, 3, 3);
    if (cells[y - 1]?.[x] !== '1') {
      ctx.fillStyle = bright;
      ctx.fillRect(left, top, 2, 1);
    }
  }));
}

export type SpriteMood = 'strike' | 'idle' | 'think' | 'gain' | 'loss' | 'shield' | 'hit' | 'call' | 'broke' | 'recover' | 'win';

/** 同一組角色像素稿供競技場和新聞劇場使用，表情或動作覆疊在外側版位。 */
export function sprite(canvas: HTMLCanvasElement, character: InvestorCharacter, mood: SpriteMood) {
  canvas.width = 72;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const paint: Pixel = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const scale = (value: number) => Math.round(value * 2.25);
  const fill: Pixel = (color, x, y, w, h) => paint(color, scale(x), scale(y) + 2, scale(w), scale(h));
  paint('#0c1122b0', 9, 91, 54, 3);
  const lean = mood === 'hit' ? -1 : mood === 'strike' ? 1 : 0;
  const slump = mood === 'loss' || mood === 'broke' ? 1 : 0;
  if (!drawInvestorSprite(ctx, character.spriteKey, lean * 2, slump * 2)) {
    const fallback = (x: number) => Math.round(x * 1.5);
    drawInvestorArt((color, x, y, w, h) => {
      const left = character.spriteKey === 'uncle' ? 48 - x - w : x;
      paint(color, fallback(left + lean), fallback(y + slump), fallback(left + w) - fallback(left), fallback(y + h) - fallback(y));
    }, character.spriteKey);
  }
  if (mood === 'strike') {
    fill('#f6a481', 25, 15, 6, 2); fill('#fff2b8', 27, 12, 5, 1); fill('#ffcd7d', 29, 18, 3, 1);
  }
  if (mood === 'hit' || mood === 'call') {
    fill('#ff9e8a', 27, 3, 1, 5); fill('#fff0a6', 25, 5, 5, 1);
  }
  if (mood === 'gain' || mood === 'recover' || mood === 'win') {
    fill('#f3c775', 27, 3, 1, 5); fill('#ffedaa', 25, 5, 5, 1);
    fill('#f3c775', 4, 9, 1, 3); fill('#ffedaa', 3, 10, 3, 1);
  }
  if (mood === 'shield') {
    fill('#acdfff', 26, 21, 5, 1); fill('#a9dfff', 25, 20, 1, 10); fill('#acdfff', 26, 29, 5, 1);
    fill('#4585a5', 27, 23, 4, 4);
  }
  if (mood === 'think') {
    fill('#a4d2ec', 28, 5, 2, 2); fill('#a4d2ec', 30, 2, 2, 2);
  }
  if (mood === 'broke') {
    ctx.globalCompositeOperation = 'source-atop';
    fill('#273243a0', 0, 0, 32, 40);
  }
}

const cardAccents: Record<string, [number, number][]> = {
  diamond: [[3, 5], [19, 14]], cash_cow: [[2, 11], [19, 13]], dividend_king: [[2, 15], [6, 17], [18, 13]],
  compound: [[2, 13], [7, 15], [18, 7]], god: [[2, 6], [18, 11], [9, 2]],
  pack: [[3, 3], [5, 16]], snipe: [[3, 8], [19, 8]], rush: [[3, 13], [19, 11]],
  gift: [[3, 12], [17, 15]], mirror: [[4, 4], [17, 14], [16, 17]]
};

/** 將既有功能圖示延伸成三色像素牌面。 */
export function drawCardArt(canvas: HTMLCanvasElement, icon: PixelIcon, color: string, design = '') {
  const ctx = canvas.getContext('2d')!;
  const fill: Pixel = (paint, x, y, w, h) => { ctx.fillStyle = paint; ctx.fillRect(x, y, w, h); };
  if (drawHDCard(ctx, design)) return;
  canvas.width = 24;
  canvas.height = 20;
  ctx.clearRect(0, 0, 24, 20);
  fill('#0d1523', 3, 3, 18, 14);
  fill('#0d1523', 6, 1, 12, 18);
  fill(mixColor(color, '#131b2c', .68), 4, 4, 16, 12);
  fill(mixColor(color, '#131b2c', .78), 6, 2, 12, 16);
  const shadow = mixColor(color, '#101620', .49);
  const light = mixColor(color, '#ffffff', .54);
  if (icon === 'cash' || icon === 'bills' || icon === 'gift') {
    fill(shadow, 4, 13, 5, 3); fill(light, 5, 12, 3, 1);
    fill(shadow, 16, 14, 4, 3); fill(light, 17, 13, 3, 1);
  }
  icons[icon].forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell !== '1') return;
    fill(shadow, 6 + x * 2, 5 + y * 2, 2, 2);
    fill(color, 5 + x * 2, 4 + y * 2, 2, 2);
    if (y === 0 || row[x - 1] !== '1') fill(light, 5 + x * 2, 4 + y * 2, 1, 1);
  }));
  fill(light, 20, 3, 1, 3); fill(light, 19, 4, 3, 1);
  for (const [x, y] of cardAccents[design] ?? []) {
    fill(shadow, x, y + 1, 3, 2);
    fill(light, x, y, 2, 1);
  }
}

/** 依大盤開盤、例行行情及全市場新聞的公布順序繪製 K 棒。 */
export function drawMarketBackdrop(canvas: HTMLCanvasElement) {
  const rates = (canvas.dataset.marketRates ?? '').split(',').filter(Boolean).map(Number);
  const news = (canvas.dataset.marketNews ?? '').split(',').map(Number);
  const { width, height } = canvas;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#253e54';
  for (let y = 9; y < height; y += 16) ctx.fillRect(0, y, width, 1);
  const days = Number(canvas.dataset.marketDays) || 15;
  const stride = width / days;
  for (let day = 0; day < days; day++) ctx.fillRect(Math.round(stride * day), 0, 1, height);
  if (!rates.length) return;

  let index = 100;
  const candles = rates.map((rate, day) => {
    const open = index;
    const middle = open * (1 + rate);
    const close = open * (1 + rate + (news[day] ?? 0));
    index = close;
    return { open, close, low: Math.min(open, middle, close), high: Math.max(open, middle, close) };
  });
  const floor = Math.min(98, ...candles.map(candle => candle.low));
  const ceiling = Math.max(102, ...candles.map(candle => candle.high));
  const y = (price: number) => Math.round(height - 6 - (price - floor) * (height - 12) / (ceiling - floor));
  const style = getComputedStyle(canvas);
  const size = Math.max(4, Math.floor(stride * 0.58));
  for (const [day, candle] of candles.entries()) {
    const left = Math.round((day + 0.5) * stride - size / 2);
    const top = Math.min(y(candle.open), y(candle.close));
    ctx.fillStyle = style.getPropertyValue(candle.close >= candle.open ? '--gain' : '--loss').trim();
    ctx.fillRect(left + Math.floor(size / 2), y(candle.high), 1, Math.max(1, y(candle.low) - y(candle.high)));
    ctx.fillRect(left, top, size, Math.max(2, Math.abs(y(candle.close) - y(candle.open))));
  }
}
