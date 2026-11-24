import type { AnimationId, SceneId, TheaterConfig } from '../config/theater-settings';
import { mixColor, type Pixel } from './pixels';
import type { Tone } from './theater-script';

export const SCENE_W = 160;
export const SCENE_H = 90;
const GROUND = 72;

/** Cheap deterministic noise so scenery is identical every frame and never touches game randomness. */
const noise = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

interface Paint { px: Pixel; t: number; accent: string; sky: string; up: string; down: string }

function sky(p: Paint, top: string, bottom: string) {
  for (let y = 0; y < GROUND; y += 3) p.px(mixColor(top, bottom, y / GROUND), 0, y, SCENE_W, 3);
  for (let i = 0; i < 22; i++) p.px(i % 5 ? '#ffffff22' : mixColor(p.accent, '#ffffff', .4), noise(i) * SCENE_W | 0, noise(i + 40) * 34 | 0, 1, 1);
}
function floor(p: Paint, color: string, line: string) {
  p.px(color, 0, GROUND, SCENE_W, SCENE_H - GROUND);
  p.px(line, 0, GROUND, SCENE_W, 1);
  for (let x = 0; x < SCENE_W; x += 12) p.px('#00000022', x, GROUND + 2, 6, 1);
}
/** Skyline silhouette, adapted from the climbing version's title art. */
function skyline(p: Paint, color: string, windows: string) {
  for (let i = 0; i < 12; i++) {
    const x = i * 14 - 4;
    const h = 14 + (i * 29) % 30;
    p.px(color, x, GROUND - h, 12, h);
    for (let row = 4; row < h - 4; row += 6) if (noise(i * 9 + row) > .45) p.px(windows, x + 4, GROUND - h + row, 2, 2);
  }
}
/** The climbing version's eight-way impact burst, reused for fireworks and shocks. */
export function burst(p: Pixel, color: string, x: number, y: number, age: number, size = 1) {
  const travel = age * 18 * size;
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    p(color, Math.round(x + Math.cos(angle) * (4 + travel)), Math.round(y + Math.sin(angle) * (3 + travel / 1.4)), 2, 2);
  }
}

const scenes: Record<SceneId, (p: Paint) => void> = {
  ai_lab(p) {
    sky(p, '#0d1330', p.sky);
    floor(p, '#151b33', '#3c4d7a');
    for (let i = 0; i < 6; i++) {
      const x = 6 + i * 26;
      p.px('#202a4c', x, 28, 18, 44);
      p.px('#0c1124', x + 2, 30, 14, 40);
      for (let row = 0; row < 8; row++) {
        p.px('#2c3a64', x + 3, 32 + row * 5, 12, 3);
        if (noise(i * 13 + row + Math.floor(p.t * 6)) > .5) p.px(p.accent, x + 12, 33 + row * 5, 2, 1);
      }
    }
    const glow = 2 + Math.round(Math.sin(p.t * 4) * 1.5);
    p.px(mixColor(p.accent, '#000000', .5), 66 - glow, 4 - glow / 2, 28 + glow * 2, 20 + glow);
    p.px('#111a36', 68, 6, 24, 16);
    p.px(p.accent, 74, 10, 12, 8);
    for (let k = 0; k < 4; k++) { p.px(p.accent, 70 + k * 6, 3, 2, 3); p.px(p.accent, 70 + k * 6, 22, 2, 3); }
  },
  fab(p) {
    sky(p, '#0f2129', p.sky);
    floor(p, '#1a2b2b', '#4d7a6c');
    p.px('#284241', 50, 34, 110, 38);
    for (let i = 0; i < 6; i++) { p.px('#355653', 50 + i * 19, 26, 10, 8); p.px('#284241', 60 + i * 19, 30, 9, 4); }
    for (let i = 0; i < 5; i++) p.px(noise(i + Math.floor(p.t * 3)) > .2 ? '#a8f0d0' : '#3d6460', 58 + i * 20, 46, 12, 6);
    for (const x of [128, 146]) {
      p.px('#3b5150', x, 8, 7, 26);
      for (let k = 0; k < 4; k++) {
        const rise = (p.t * 10 + k * 7) % 28;
        p.px('#cfe3dd55', x - 2 + k % 2 * 3, 6 - rise, 6 - k, 3);
      }
    }
    // wafer
    const cx = 24, cy = 40, r = 18;
    for (let y = -r; y <= r; y++) {
      const dx = Math.floor(Math.sqrt(r * r - y * y));
      p.px(y % 4 ? '#8fb7d6' : '#5f84a8', cx - dx, cy + y, dx * 2, 1);
    }
    for (let x = -r + 3; x < r; x += 5) p.px('#47688a', cx + x, cy - r + 4, 1, r * 2 - 8);
    p.px('#ffffff99', cx - 10 + (Math.floor(p.t * 20) % 20), cy - 8, 3, 3);
  },
  exchange(p) {
    sky(p, '#121528', p.sky);
    floor(p, '#1f1c2c', '#7a6a3d');
    p.px('#0b0d18', 14, 6, 132, 40);
    p.px(p.accent, 14, 6, 132, 1);
    for (let i = 0; i < 16; i++) {
      const up = noise(i * 3) > .45;
      const h = 4 + noise(i * 7) * 16;
      const base = 26 + noise(i * 5) * 8;
      p.px(up ? p.up : p.down, 20 + i * 8, base - h / 2, 4, h);
      p.px('#ffffff44', 21 + i * 8, base - h / 2 - 3, 1, h + 6);
    }
    p.px('#2a2433', 0, 50, SCENE_W, 7);
    const scroll = Math.floor(p.t * 24) % 32;
    for (let i = -1; i < 6; i++) { p.px(i % 2 ? p.up : p.down, i * 32 - scroll, 52, 18, 3); p.px('#ffffff55', i * 32 - scroll + 20, 52, 6, 3); }
    for (let i = 0; i < 5; i++) { p.px('#3a3245', 8 + i * 32, 60, 22, 12); p.px('#6a5c7a', 10 + i * 32, 61, 18, 4); }
  },
  central_bank(p) {
    sky(p, '#151c2e', p.sky);
    floor(p, '#2a2c34', '#8d8466');
    p.px('#c9bf9f', 30, 26, 100, 4);
    for (let i = 0; i < 18; i++) p.px('#d8cfae', 32 + i * 2.6, 26 - i, 100 - i * 5.2 > 0 ? 100 - i * 5.2 : 0, 1);
    for (let i = 0; i < 6; i++) { p.px('#e6dec0', 36 + i * 17, 30, 7, 34); p.px('#b9ae8c', 36 + i * 17, 30, 1, 34); }
    for (let i = 0; i < 3; i++) p.px('#a79c7c', 26 - i * 4, 64 + i * 3, 108 + i * 8, 3);
    p.px('#ddd', 79, -2, 1, 12);
    const wave = Math.round(Math.sin(p.t * 5));
    p.px(p.accent, 80, 0 + wave, 12, 3);
    p.px(mixColor(p.accent, '#000', .3), 80, 3 + wave, 12, 3);
    p.px('#ebc56d', 74, 14, 12, 6);
    p.px('#151c2e', 78, 16, 4, 2);
  },
  press(p) {
    sky(p, '#1d1830', p.sky);
    for (let x = 0; x < SCENE_W; x += 10) p.px(x % 20 ? '#3a2448' : '#4a2c58', x, 0, 10, GROUND);
    floor(p, '#2b2030', '#6d4d6d');
    p.px('#202a4c', 40, 8, 80, 16);
    p.px('#f2eddf', 44, 12, 72, 1);
    p.px('#f2eddf', 44, 17, 50, 1);
    p.px('#5a3d2b', 64, 46, 32, 26);
    p.px('#7a553b', 64, 46, 32, 3);
    p.px(p.accent, 76, 54, 8, 6);
    for (let i = 0; i < 5; i++) { p.px('#222', 66 + i * 6, 38, 1, 9); p.px(['#e55', '#5ae', '#fd5', '#5d8', '#ccc'][i], 65 + i * 6, 36, 3, 3); }
    for (let i = 0; i < 6; i++) {
      if (noise(i * 17 + Math.floor(p.t * 7)) > .78) {
        const x = 8 + i * 27, y = 56;
        p.px('#ffffff', x, y, 4, 3);
        burst(p.px, '#ffffffaa', x + 2, y + 1, .2, .6);
      }
      p.px('#1a1a22', 6 + i * 27, 60, 8, 6);
    }
  },
  port(p) {
    sky(p, '#0f2238', p.sky);
    p.px(mixColor(p.accent, '#ffffff', .2), 120, 10, 12, 12);
    for (let y = GROUND - 14; y < SCENE_H; y += 3) p.px(mixColor('#1f4d73', '#0b2236', (y - GROUND + 14) / 30), 0, y, SCENE_W, 3);
    for (let i = 0; i < 12; i++) p.px('#9fd0ff55', (i * 17 + Math.floor(p.t * 12)) % SCENE_W, GROUND - 10 + (i % 3) * 7, 6, 1);
    p.px('#e0e0e0', 18, 10, 3, 48);
    p.px('#e0e0e0', 18, 10, 46, 3);
    p.px('#444', 52, 13, 1, 16 + Math.round(Math.sin(p.t * 2) * 3));
    const colors = ['#d9534f', '#5bc0de', '#f0ad4e', '#5cb85c', '#9b6bd3'];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4 - r; c++) p.px(colors[(r * 4 + c) % 5], 70 + c * 14 + r * 7, 46 - r * 7, 13, 6);
    p.px('#2b2f3a', 60, 52, 80, 8);
    p.px('#3c4252', 64, 60, 72, 2);
  },
  energy(p) {
    sky(p, '#1d1424', p.sky);
    floor(p, '#231d22', '#5a4a3a');
    for (const x of [20, 80, 140]) {
      p.px('#4a4552', x - 1, 14, 2, 58);
      p.px('#4a4552', x - 10, 20, 20, 2);
      p.px('#4a4552', x - 7, 28, 14, 2);
      for (let k = -8; k <= 8; k += 8) p.px('#888', x + k, 22, 1, 2);
    }
    for (let x = 20; x < 140; x++) p.px('#6a6070', x, 22 + Math.round(Math.sin((x % 60) / 60 * Math.PI) * 5), 1, 1);
    if (Math.floor(p.t * 4) % 5 === 0) for (let y = 0; y < 40; y += 4) p.px(p.accent, 100 + (y % 8 ? 3 : 0), y, 2, 4);
    p.px('#3a3030', 44, 50, 14, 22);
    p.px('#ffd45e', 47, 54, 8, 3);
    p.px('#5a4038', 112, 44, 18, 28);
    p.px('#2a2020', 116, 38, 10, 6);
  },
  vault(p) {
    sky(p, '#151718', p.sky);
    floor(p, '#26282a', '#6a5a30');
    for (let x = 0; x < SCENE_W; x += 16) p.px('#2a2d30', x, 0, 15, GROUND);
    const cx = 54, cy = 36, r = 26;
    for (let y = -r; y <= r; y++) {
      const dx = Math.floor(Math.sqrt(r * r - y * y));
      p.px(Math.abs(y) > r - 3 ? '#8a8f96' : '#5b6068', cx - dx, cy + y, dx * 2, 1);
    }
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3 + p.t * .8;
      for (let d = 2; d < 14; d += 2) p.px('#c9ced6', Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 2, 2);
    }
    p.px('#e0e4ea', cx - 3, cy - 3, 6, 6);
    for (let r2 = 0; r2 < 3; r2++) for (let c = 0; c < 4 - r2; c++) {
      p.px(p.accent, 100 + c * 13 + r2 * 6, 64 - r2 * 6, 12, 5);
      p.px('#fff3b0', 101 + c * 13 + r2 * 6, 64 - r2 * 6, 10, 1);
    }
  },
  chatroom(p) {
    sky(p, '#0f1d1d', p.sky);
    floor(p, '#162424', '#3e6a5a');
    p.px('#0a1414', 40, 2, 80, 70);
    p.px('#264040', 42, 4, 76, 66);
    const scroll = (p.t * 8) % 12;
    for (let i = 0; i < 7; i++) {
      const y = 62 - i * 12 + scroll;
      if (y < 6 || y > 64) continue;
      const left = noise(i) > .5;
      const w = 22 + noise(i + 3) * 24;
      p.px(left ? '#e8f4ee' : p.accent, left ? 46 : 114 - w, y, w, 7);
      const emoji = noise(i + 9);
      p.px(emoji > .6 ? '#ffd54f' : emoji > .3 ? '#ff6f6f' : '#7fe0ff', left ? 48 + w - 6 : 116 - w + 2, y + 2, 3, 3);
    }
    for (let i = 0; i < 4; i++) { p.px('#ffd54f', 10 + i * 6, 20 + i * 11, 6, 6); p.px('#222', 12 + i * 6, 22 + i * 11, 1, 1); p.px('#222', 14 + i * 6, 22 + i * 11, 1, 1); }
  },
  broker(p) {
    sky(p, '#161d28', p.sky);
    for (let x = 0; x < SCENE_W; x += 32) { p.px('#24303f', x + 4, 6, 24, 18); p.px('#5b7fa0', x + 6, 8, 20, 14); }
    floor(p, '#1e2632', '#4a6078');
    for (let i = 0; i < 4; i++) {
      const x = 6 + i * 40;
      p.px('#3a2e26', x, 54, 34, 4);
      p.px('#2a2222', x + 2, 58, 3, 14);
      p.px('#2a2222', x + 29, 58, 3, 14);
      p.px('#0d1118', x + 6, 38, 22, 15);
      for (let k = 0; k < 5; k++) p.px(noise(i * 5 + k) > .5 ? p.up : p.down, x + 8 + k * 4, 42 + noise(i + k) * 8, 2, 3);
      const ring = Math.floor(p.t * 8 + i) % 4 === 0;
      p.px(p.accent, x + 26 + (ring ? 1 : 0), 50, 6, 3);
      if (ring) { p.px(p.accent, x + 33, 47, 1, 2); p.px(p.accent, x + 25, 47, 1, 2); }
    }
  },
  black_swan(p) {
    sky(p, '#12040a', p.sky);
    floor(p, '#1a0a0e', '#7a2030');
    const flash = Math.floor(p.t * 3) % 4 === 0;
    if (flash) p.px('#ff6f6f18', 0, 0, SCENE_W, GROUND);
    for (let i = 0; i < 5; i++) {
      let x = 20 + i * 30, y = GROUND;
      for (let k = 0; k < 6; k++) { p.px('#000', x, y, 1, 3); x += noise(i * 9 + k) > .5 ? 1 : -1; y += 2; }
    }
    // swan silhouette
    const bob = Math.round(Math.sin(p.t * 2) * 2);
    const body = '#050205';
    p.px(body, 56, 34 + bob, 44, 14);
    p.px(body, 52, 38 + bob, 6, 8);
    p.px(body, 92, 22 + bob, 5, 16);
    p.px(body, 94, 16 + bob, 10, 7);
    p.px('#ff6f6f', 102, 19 + bob, 5, 2);
    p.px(body, 60, 26 + bob, 30, 8);
    p.px(body, 64, 20 + bob, 22, 6);
    for (let i = 0; i < 14; i++) {
      const fall = (p.t * 20 + i * 11) % 80;
      p.px(i % 3 ? p.down : '#ff6f6f', (i * 23) % SCENE_W, fall - 6, 2, 4);
    }
  },
  party(p) {
    sky(p, '#140a24', p.sky);
    skyline(p, '#1f1535', '#ffd45e');
    floor(p, '#1e1430', '#6a3d7a');
    for (let k = 0; k < 3; k++) {
      const phase = (p.t * .7 + k * .33) % 1;
      burst(p.px, ['#ff9ad5', '#ffd45e', '#7fe0ff'][k], 30 + k * 50, 16 + (k % 2) * 8, phase, 1.2);
    }
    for (let i = 0; i < 26; i++) {
      const y = (p.t * 22 + noise(i) * 80) % 80;
      p.px(['#ff9ad5', '#ffd45e', '#7fe0ff', '#9fe3c4'][i % 4], (noise(i + 5) * SCENE_W + Math.sin(p.t * 3 + i) * 3) | 0, y - 8, 2, 2);
    }
    const ry = 50 - ((p.t * 30) % 70);
    p.px('#e9eef5', 134, ry, 4, 9);
    p.px('#ff6f6f', 134, ry - 2, 4, 2);
    p.px('#ffd45e', 135, ry + 9, 2, 3 + Math.floor(p.t * 10) % 3);
  }
};

/** Event-specific motion layered over the scene, driven by the actual market tone. */
function animate(p: Paint, id: AnimationId, tone: Tone, strength: number) {
  const color = tone === 'negative' ? p.down : tone === 'positive' ? p.up : '#cbd5d9';
  const count = Math.round(10 * strength);
  if (id === 'rally' || id === 'drift_up' || id === 'rebound') {
    for (let i = 0; i < count; i++) {
      const y = SCENE_H - ((p.t * (id === 'drift_up' ? 18 : 34) + i * 13) % (SCENE_H + 10));
      const x = (i * 37 + 11) % SCENE_W;
      p.px(color, x, y, 2, 5);
      p.px(color, x - 1, y + 1, 4, 1);
    }
  } else if (id === 'dip' || id === 'crash') {
    for (let i = 0; i < count * (id === 'crash' ? 2 : 1); i++) {
      const y = (p.t * (id === 'crash' ? 46 : 24) + i * 11) % (SCENE_H + 10) - 8;
      p.px(color, (i * 29 + 5) % SCENE_W, y, 2, 6);
    }
    if (id === 'crash' && Math.floor(p.t * 6) % 3 === 0) p.px('#ff000014', 0, 0, SCENE_W, SCENE_H);
  } else if (id === 'rotate') {
    const shift = Math.floor(p.t * 30) % SCENE_W;
    for (let i = 0; i < 6; i++) {
      p.px(p.up, (shift + i * 28) % SCENE_W, 30, 10, 2);
      p.px(p.down, SCENE_W - ((shift + i * 28) % SCENE_W), 40, 10, 2);
    }
  } else if (id === 'swan' || id === 'glitch') {
    for (let i = 0; i < count * 2; i++) {
      const y = (p.t * 38 + i * 9) % (SCENE_H + 10) - 8;
      p.px(id === 'swan' ? '#f2eddf' : color, (i * 31 + 7) % SCENE_W, y, id === 'swan' ? 3 : 2, id === 'swan' ? 2 : 5);
    }
  }
}

export interface SceneFrame { sceneId: SceneId; animationId: AnimationId | null; tone: Tone; t: number; strength: number; glitch: boolean }

export function drawScene(canvas: HTMLCanvasElement, theater: TheaterConfig, frame: SceneFrame, colors: { up: string; down: string }) {
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const px: Pixel = (color, x, y, w, h) => { if (w > 0 && h > 0) { ctx.fillStyle = color; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); } };
  const info = theater.scenes[frame.sceneId];
  const paint: Paint = { px, t: frame.t, accent: info.accent, sky: info.sky, up: colors.up, down: colors.down };
  scenes[frame.sceneId](paint);
  if (frame.animationId) animate(paint, frame.animationId, frame.tone, frame.strength);
  if (frame.glitch) {
    for (let i = 0; i < 6; i++) {
      const y = Math.floor(noise(i + Math.floor(frame.t * 12)) * SCENE_H);
      const slice = ctx.getImageData(0, y, SCENE_W, 4);
      ctx.putImageData(slice, Math.round((noise(i * 3 + frame.t) - .5) * 14), y);
    }
  }
}

/** 32×32 portraits for the news cast. */
export function speakerPortrait(canvas: HTMLCanvasElement, speaker: TheaterConfig['speakers'][string], talking: boolean) {
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const px: Pixel = (color, x, y, w, h) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
  px(mixColor(speaker.color, '#131925', .82), 0, 0, 32, 32);
  for (let x = 0; x < 32; x += 4) px('#ffffff0d', x, 0, 1, 32);
  const skin = '#f3c29b';
  const dark = '#101521';
  const look = speaker.look;
  const hair = look === 'professor' || look === 'uncle' ? '#d4d8da' : look === 'anchor' ? '#3a2430' : '#27303b';
  px(dark, 8, 4, 16, 18);
  px(hair, 9, 4, 14, 6);
  px(skin, 10, 8, 12, 11);
  if (look === 'anchor') { px(hair, 7, 6, 4, 16); px(hair, 21, 6, 4, 16); px('#e98dc7', 22, 9, 2, 2); }
  if (look === 'reporter') { px('#6fb7ff', 8, 3, 16, 4); px('#4a8ad0', 20, 6, 8, 2); }
  if (look === 'professor' || look === 'uncle') { px('#4b4a58', 11, 11, 10, 2); px('#f3efe1', 12, 11, 3, 2); px('#f3efe1', 17, 11, 3, 2); }
  if (look === 'broker') { px('#222', 8, 10, 2, 6); px('#a4d2ec', 7, 14, 3, 3); px('#222', 9, 16, 6, 1); }
  px(dark, 13, 12, 2, 2);
  px(dark, 18, 12, 2, 2);
  px(talking ? '#8a3a3a' : '#bd826e', 14, 16, 5, talking ? 2 : 1);
  px(dark, 5, 22, 22, 10);
  px(look === 'uncle' ? '#4e8e81' : look === 'professor' ? '#6a5a44' : speaker.color, 6, 23, 20, 9);
  px('#f2eddf', 14, 23, 4, 4);
  if (look === 'anchor' || look === 'broker') px('#c03a4a', 15, 24, 2, 6);
  if (look === 'reporter') { px('#333', 24, 18, 3, 8); px('#888', 23, 16, 5, 3); }
}
