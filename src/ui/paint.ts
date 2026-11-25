import type { FinancialConfig, PixelIcon } from '../config/financial-settings';
import { drawCardArt, drawIcon, drawMarketBackdrop, portrait, sprite, type SpriteMood, type SystemIcon } from './pixels';

/** Draws every pixel canvas in a rendered fragment (portraits, sprites, city, card art, icons). */
export function paintCanvases(parent: ParentNode, config: FinancialConfig) {
  parent.querySelectorAll<HTMLCanvasElement>('[data-portrait]').forEach(canvas => {
    const character = config.characters.find(item => item.id === canvas.dataset.portrait);
    if (character) portrait(canvas, character);
  });
  parent.querySelectorAll<HTMLCanvasElement>('[data-sprite]').forEach(canvas => {
    const character = config.characters.find(item => item.id === canvas.dataset.sprite);
    if (character) sprite(canvas, character, (canvas.dataset.mood ?? 'idle') as SpriteMood);
  });
  parent.querySelectorAll<HTMLCanvasElement>('[data-market-rates]').forEach(drawMarketBackdrop);
  parent.querySelectorAll<HTMLCanvasElement>('[data-card-art]').forEach(canvas => drawCardArt(canvas, canvas.dataset.cardArt as PixelIcon, canvas.dataset.color!, canvas.dataset.cardDesign));
  parent.querySelectorAll<HTMLCanvasElement>('[data-icon]').forEach(canvas => drawIcon(canvas, canvas.dataset.icon as SystemIcon, canvas.dataset.color!));
}
