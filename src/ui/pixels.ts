import type { Card, Character, PixelIcon } from '../config/settings';

type Pixel = (color: string, x: number, y: number, width: number, height: number) => void;

export function mixColor(first: string, second: string, weight: number) {
  const a = Number.parseInt(first.slice(1), 16);
  const b = Number.parseInt(second.slice(1), 16);
  const channels = [16, 8, 0].map(shift => Math.round(((a >> shift) & 255) * (1 - weight) + ((b >> shift) & 255) * weight));
  return '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
}

export function pixelRacer(pixel: Pixel, character: Character, x: number, y: number, scale: number, step = 0, flipped = false) {
  const draw = (color: string, left: number, top: number, width: number, height: number) =>
    pixel(color, x + (flipped ? 12 - left - width : left) * scale, y + top * scale, width * scale, height * scale);
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
  draw(skin, shoulder, 9 + (step === 1 ? 1 : 0), 1, 2);
  draw(skin, 11 - shoulder, 9 + (step === -1 ? 1 : 0), 1, 2);
  draw(pants, 3, 11, 2, 3 + (step === 1 ? -1 : 0));
  draw(pants, 7, 11, 2, 3 + (step === -1 ? -1 : 0));
  draw(dark, 3 - (step === -1 ? 1 : 0), step === 1 ? 13 : 14, 3, 1);
  draw(dark, 7, step === -1 ? 13 : 14, 3, 1);
}

export function portrait(canvas: HTMLCanvasElement, character: Character) {
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = mixColor(character.color, '#131925', 0.85);
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = 'rgba(255,255,255,.055)';
  for (let x = 0; x < 32; x += 4) ctx.fillRect(x, 0, 1, 32);
  ctx.fillStyle = '#202b37';
  ctx.fillRect(3, 29, 26, 2);
  pixelRacer((color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); }, character, 4, 2, 2);
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

export function cardIcon(canvas: HTMLCanvasElement, card: Card) {
  drawIcon(canvas, card.icon, card.color);
}

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

export function titleArt(canvas: HTMLCanvasElement, characters: Character[]) {
  canvas.width = 250;
  canvas.height = 196;
  const ctx = canvas.getContext('2d')!;
  const pixel: Pixel = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  pixel('#182439', 0, 0, 250, 196);
  for (let y = 0; y < 196; y += 4) pixel(y < 76 ? '#1e2c42' : '#24364c', 0, y, 250, 1);
  for (let i = 0; i < 35; i++) {
    const x = (i * 43 + 2) % 241;
    const y = (i * 67 + 11) % 102;
    pixel(i % 5 === 0 ? '#eac86e' : '#52738e', x, y, i % 5 === 0 ? 2 : 1, 1);
  }
  for (let y = 0; y < 56; y++) {
    const dx = Math.floor(Math.sqrt(28 ** 2 - (y - 28) ** 2));
    pixel(y < 36 ? '#f4ce72' : '#cb8a5c', 194 - dx, 25 + y, dx * 2, y > 34 && y % 3 === 0 ? 0 : 1);
  }
  for (let i = 0; i < 13; i++) {
    const x = i * 21;
    const height = 18 + (i * 29) % 57;
    pixel('#202c40', x, 150 - height, 17, height);
    pixel('#34475b', x + 4, 145 - height, 4, 3);
    for (let row = 0; row < height - 12; row += 8) pixel(i % 3 ? '#3c5864' : '#aa7961', x + 8, 158 - height + row, 3, 3);
  }
  for (let i = 0; i < 9; i++) {
    const y = 133 - i * 8 + (i % 3) * 9;
    const x = 15 + i * 19;
    const color = i % 3 ? '#4e8e81' : '#a37377';
    pixel(color, x + 3, y - 11, 1, 24);
    pixel(color, x, y - 4, 7, 9);
  }

  const ledges = [
    { x: 0, y: 179, w: 250 }, { x: 16, y: 152, w: 96 }, { x: 75, y: 123, w: 105 },
    { x: 125, y: 94, w: 107 }, { x: 160, y: 66, w: 54 }, { x: 173, y: 54, w: 28 }
  ];
  ledges.forEach(({ x, y, w }, i) => {
    if (i) {
      const lower = ledges[i - 1];
      const ladderX = Math.max(x, lower.x) + 8;
      pixel('#a97749', ladderX, y, 2, lower.y - y);
      pixel('#d5a165', ladderX + 7, y, 2, lower.y - y);
      for (let row = 0; row < lower.y - y; row += 5) pixel('#d5a165', ladderX, y + row, 9, 1);
    }
    pixel('#172125', x, y, w, 9);
    pixel(i > 3 ? '#efc36b' : '#89c391', x, y, w, 2);
    for (let tile = 1; tile < w - 9; tile += 10) {
      pixel(i > 3 ? '#aa713e' : '#47715a', x + tile, y + 2, 9, 5);
      pixel(i > 3 ? '#f7d98c' : '#6e9c70', x + tile + 2, y + 3, 5, 1);
    }
  });
  pixel('#edc473', 193, 39, 1, 16);
  pixel('#f4d585', 194, 39, 11, 5);
  pixel('#ca8b52', 194, 44, 7, 2);
  pixelRacer(pixel, characters[0], 89, 108, 1, 1);
  pixelRacer(pixel, characters[1], 137, 79, 1, -1);
  pixelRacer(pixel, characters[2], 44, 137, 1);
  pixelRacer(pixel, characters[3], 170, 51, 1);
  pixel('#f5c971', 65, 143, 7, 8);
  pixel('#885533', 66, 144, 5, 6);
  pixel('#ffd989', 67, 145, 3, 1);
  pixel('#ffd989', 68, 146, 1, 3);
}
