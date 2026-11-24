import type { FinancialConfig, InvestorCharacter } from '../config/financial-settings';

type PixelIcon = FinancialConfig['cards'][number]['icon'];

type Pixel = (color: string, x: number, y: number, width: number, height: number) => void;

export function mixColor(first: string, second: string, weight: number) {
  const a = Number.parseInt(first.slice(1), 16);
  const b = Number.parseInt(second.slice(1), 16);
  const channels = [16, 8, 0].map(shift => Math.round(((a >> shift) & 255) * (1 - weight) + ((b >> shift) & 255) * weight));
  return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
}

function drawInvestor(pixel: Pixel, character: InvestorCharacter, x: number, y: number, scale: number) {
  const draw = (color: string, left: number, top: number, width: number, height: number) =>
    pixel(color, x + left * scale, y + top * scale, width * scale, height * scale);
  const dark = '#101521';
  const skin = '#f3c29b';
  const shade = '#bd826e';
  const jacket = character.color;
  const pants = mixColor(jacket, dark, 0.78);
  const senior = character.spriteKey === 'uncle';
  const strong = character.spriteKey === 'pan';
  const cap = character.spriteKey === 'you';
  const ponytail = character.spriteKey === 'ting';
  const hair = senior ? '#d4d8da' : (ponytail ? '#36283d' : '#27303b');

  draw(dark, 3, 0, 6, 1);
  draw(dark, 2, 1, 8, 6);
  draw(skin, 3, 3, 6, 4);
  draw(shade, 3, 5, 1, 2);
  draw('#ffe0b2', 6, 5, 3, 1);
  draw(hair, 3, 1, 6, 2);
  draw(hair, 2, 2, 2, 2);
  draw(dark, 7, 4, 1, 1);
  if (senior) {
    draw('#4b4a58', 5, 4, 5, 1);
    draw('#f3efe1', 6, 4, 1, 1);
    draw('#e9e4d5', 4, 6, 3, 1);
  }
  if (cap) {
    draw('#f3cb62', 2, 1, 7, 2);
    draw('#c18c3d', 7, 2, 4, 1);
  }
  if (ponytail) {
    draw(hair, 1, 3, 2, 5);
    draw('#e98dc7', 1, 4, 1, 1);
  }

  const shoulder = strong ? 1 : 2;
  draw(dark, shoulder, 7, 12 - shoulder * 2, 5);
  draw(jacket, shoulder + 1, 7, 10 - shoulder * 2, 4);
  draw(mixColor(jacket, '#ffffff', 0.45), 4, 7, 4, 1);
  draw(mixColor(jacket, dark, 0.44), 3, 10, 6, 1);
  draw(skin, shoulder, 9, 1, 2);
  draw(skin, 11 - shoulder, 9, 1, 2);
  draw(pants, 3, 11, 2, 3);
  draw(pants, 7, 11, 2, 3);
  draw(dark, 3, 14, 3, 1);
  draw(dark, 7, 14, 3, 1);
}

export function portrait(canvas: HTMLCanvasElement, character: InvestorCharacter) {
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = mixColor(character.color, '#131925', 0.85);
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = 'rgba(255,255,255,.055)';
  for (let x = 0; x < 32; x += 4) ctx.fillRect(x, 0, 1, 32);
  ctx.fillStyle = '#202b37';
  ctx.fillRect(3, 29, 26, 2);
  drawInvestor((color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }, character, 4, 2, 2);
}

const icons: Record<PixelIcon, string[]> = {
  shield: ['0111110','0100010','0111010','0100010','0010100','0001000'],
  rocket: ['0011100','0011100','0010100','0111110','0101010','0001000'],
  short: ['1111111','1111111','0111110','0011100','0011100','0001000'],
  eye: ['0011100','0100010','1011101','1010101','0100010','0011100'],
  bolt: ['0011100','0111000','1111110','0011110','0011100','0110000'],
  trap: ['1111111','1000001','1010101','1001001','1010101','1111111'],
  anchor: ['0011100','0010100','0011100','0001000','1001001','0111110'],
  cash: ['0011100','0110000','0011100','0000110','0111000','0001000'],
  chart: ['0100010','1110010','1110111','0100111','0100010','0000010'],
  bull: ['1000001','1100011','1111111','0111110','0011100','0011100'],
  bear: ['1100011','1111111','1101011','1111111','0111110','0011100'],
  bank: ['0001000','0011100','0111110','0101010','0101010','1111111'],
  up: ['0001000','0011100','0111110','1111111','0011100','0011100'],
  down: ['0011100','0011100','1111111','0111110','0011100','0001000'],
  bills: ['0111110','1111111','1001001','1011101','1001001','1111111'],
  halt: ['0111110','1101011','1101011','1101011','1101011','0111110']
};

export function drawIcon(canvas: HTMLCanvasElement, icon: PixelIcon, color: string) {
  canvas.width = 10;
  canvas.height = 9;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  icons[icon].forEach((row, y) => {
    [...row].forEach((cell, x) => {
      if (cell === '1') ctx.fillRect(x + 1, y + 1, 1, 1);
    });
  });
}

export type SpriteMood = 'idle' | 'think' | 'gain' | 'loss' | 'shield' | 'hit' | 'call' | 'broke' | 'recover' | 'win';

/**
 * Full-body arena sprite (24×30 at 2× scale inside a 28×34 canvas) with a mood face and prop.
 * Motion itself (bounce, shake, slump) is CSS on the canvas so it stays skippable and reduced-motion safe.
 */
export function sprite(canvas: HTMLCanvasElement, character: InvestorCharacter, mood: SpriteMood) {
  canvas.width = 28;
  canvas.height = 34;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 28, 34);
  const fill = (color: string, x: number, y: number, w: number, h: number) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  const ox = 2;
  const oy = 3;
  const at = (color: string, x: number, y: number, w = 1, h = 1) => fill(color, ox + x * 2, oy + y * 2, w * 2, h * 2);
  fill('#0006', 5, 32, 18, 2);
  drawInvestor(fill, character, ox, oy, 2);
  const dark = '#101521';
  const skin = '#f3c29b';
  // Face: eye at (7,4), mouth row 6.
  if (mood === 'broke') {
    at(skin, 7, 4); fill(dark, ox + 14, oy + 8, 1, 1); fill(dark, ox + 15, oy + 9, 1, 1); fill(dark, ox + 15, oy + 8, 1, 1); fill(dark, ox + 14, oy + 9, 1, 1);
    at(dark, 6, 6, 2, 1);
  } else if (mood === 'gain' || mood === 'win' || mood === 'recover') {
    at('#ffe0b2', 6, 5, 3, 1); at(dark, 6, 6, 3, 1); fill('#d65a5a', ox + 14, oy + 13, 2, 1);
  } else if (mood === 'loss' || mood === 'hit') {
    at(dark, 6, 6, 2, 1); fill('#7fd0ff', ox + 4, oy + 6, 2, 3);
  } else if (mood === 'call') {
    at(dark, 7, 5, 1, 2); fill('#ffffff', ox + 14, oy + 8, 1, 1);
  } else if (mood === 'think') {
    fill(dark, ox + 12, oy + 13, 4, 1);
  }
  // Props drawn in canvas space.
  if (mood === 'gain' || mood === 'win') {
    // arms up
    at(skin, 0, 5, 1, 3); at(skin, 11, 5, 1, 3);
    fill('#f3cb62', 0, 0, 4, 4); fill('#c18c3d', 1, 1, 2, 2);
  }
  if (mood === 'win') {
    fill('#f3cb62', ox + 6, 0, 12, 3); fill('#f3cb62', ox + 6, 0, 2, 1); fill('#ffe58a', ox + 11, 0, 2, 1);
    fill('#c18c3d', ox + 6, 2, 12, 1);
  }
  if (mood === 'shield') {
    ctx.strokeStyle = '#a4d2ec';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 27, 31);
    fill('#a4d2ec', 22, 14, 5, 7); fill('#e8f6ff', 23, 15, 3, 1);
  }
  if (mood === 'call') {
    fill('#ffa995', 24, 2, 2, 7); fill('#ffa995', 24, 11, 2, 2);
  }
  if (mood === 'hit') {
    fill('#ffa995', 22, 4, 4, 1); fill('#ffa995', 23, 2, 1, 5); fill('#ffa995', 25, 7, 2, 1);
  }
  if (mood === 'think') {
    fill('#a4d2ec', 22, 1, 2, 2); fill('#a4d2ec', 24, 4, 3, 3);
  }
  if (mood === 'broke') {
    ctx.globalCompositeOperation = 'source-atop';
    fill('#2a3140aa', 0, 0, 28, 34);
    ctx.globalCompositeOperation = 'source-over';
  }
}
