import atlasUrl from '../assets/investor-atlas-v2.png';

type Crop = [left: number, top: number, width: number, height: number];

const frames: Record<string, { body: Crop; portrait: Crop }> = {
  pan: { body: [188, 9, 310, 601], portrait: [275, 7, 170, 170] },
  uncle: { body: [767, 8, 264, 605], portrait: [828, 7, 174, 174] },
  you: { body: [199, 630, 272, 614], portrait: [263, 630, 170, 170] },
  ting: { body: [737, 632, 310, 608], portrait: [824, 628, 180, 180] }
};

let atlas: HTMLImageElement | null = null;

/** 遊戲啟動前載入圖集。若檔案讀取失敗，畫面使用內建角色稿。 */
export async function loadInvestorSprites() {
  const image = new Image();
  image.src = atlasUrl;
  try {
    await image.decode();
    atlas = image;
  } catch {
    atlas = null;
  }
}

export function drawInvestorSprite(ctx: CanvasRenderingContext2D, key: string, offsetX: number, offsetY: number) {
  const frame = frames[key]?.body;
  if (!atlas || !frame) return false;
  const height = ctx.canvas.height - 7;
  const width = Math.round(height * frame[2] / frame[3]);
  const left = Math.floor((ctx.canvas.width - width) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, ...frame, left + offsetX, 3 + offsetY, width, height);
  return true;
}

export function drawInvestorPortrait(ctx: CanvasRenderingContext2D, key: string, size: number) {
  const frame = frames[key]?.portrait;
  if (!atlas || !frame) return false;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(atlas, ...frame, 0, 0, size, size);
  return true;
}
