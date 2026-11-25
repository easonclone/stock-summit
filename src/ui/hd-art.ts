import jokersA from '../assets/hd-art/jokers-a.png';
import jokersB from '../assets/hd-art/jokers-b.png';
import itemsA from '../assets/hd-art/items-a.png';
import itemsB from '../assets/hd-art/items-b.png';
import jokersV34A from '../assets/hd-art/jokers-v34-a.png';
import jokersV34B from '../assets/hd-art/jokers-v34-b.png';
import itemsSacrifice from '../assets/hd-art/items-sacrifice.png';

import jokersNewA from '../assets/hd-art/jokers-new-a.png';
import jokersNewB from '../assets/hd-art/jokers-new-b.png';

const sheets = [
  { url: jokersNewA, columns: 3, size: 128, cards: ['stored_strike','time_bank','finisher','lucky_star','fate_gambler','chaos_king','oracle','insider_king','market_prophet'] },
  { url: jokersNewB, columns: 3, size: 128, cards: ['imitator','phantom','universal_mirror','blacklist','wealth_seal','financial_hegemony','last_fury','pursuer','comeback_miracle'] },
  { url: jokersV34A, columns: 3, size: 128, cards: ['bounty', 'arms_dealer', 'short_hunter', 'insurer', 'avenger', 'immovable', 'magician', 'combo_master', 'recycler'] },
  { url: jokersV34B, columns: 3, size: 128, cards: ['vip', 'reinvestment', 'patient', 'blood_contract', 'pain_transfer', 'adversity', 'phoenix', 'doom_bringer', 'rebirth'] },
  { url: itemsSacrifice, columns: 4, size: 64, cards: ['equal_exchange', 'forbidden_trade', 'mutual_doom', 'final_reckoning'] },
  { url: jokersA, columns: 3, size: 128, cards: ['cash_cow','diamond','dividend_king','bank','vest','tech','compound','bear','gambler'] },
  { url: jokersB, columns: 3, size: 128, cards: ['printer','thrifty','dip','streak','wolf','insider','holder','underdog','god'] },
  { url: itemsA, columns: 4, size: 64, cards: ['gift','trend','guard','bell','escape','tip','pack','snipe','raid','rush','shatter','mirror'] },
  { url: itemsB, columns: 4, size: 64, cards: ['double','dividend','comeback','reverse','draw_two','lucky','attack_pack','defense_pack','ticket','strike_boost','brawl','roulette'] }
];

const frames = new Map(sheets.flatMap(({ url, columns, size, cards }) => cards.map((card, index) => [
  card, { url, size, x: (index % columns) * size, y: Math.floor(index / columns) * size }
] as const)));

const assets = new Map<string, HTMLImageElement>();

export async function loadHDArt() {
  await Promise.all(sheets.map(sheet => sheet.url).map(async url => {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
      assets.set(url, image);
    } catch {
      // 素材缺失時由既有像素繪圖補位。
    }
  }));
}

export function drawHDCard(ctx: CanvasRenderingContext2D, id: string) {
  const frame = frames.get(id);
  const image = frame ? assets.get(frame.url) : undefined;
  if (!frame || !image) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, frame.x, frame.y, frame.size, frame.size, 0, 0, ctx.canvas.width, ctx.canvas.height);
  return true;
}
