import Phaser from 'phaser';
import { seededRandom } from '../core/random';

/** Skippable pixel shower over the arena: rising or falling ticks in the market colour. Purely decorative. */
export function mountMarketEffect(parent: HTMLElement, seed: number, color: number, intense: boolean, width = 212, height = 56, rising = true) {
  const random = seededRandom(seed);
  const pixels = Array.from({ length: intense ? 46 : 24 }, () => ({
    x: random() * width, y: rising ? height * (0.55 + random() * 0.45) : height * random() * 0.45,
    dx: (random() - 0.5) * 24, dy: (rising ? -1 : 1) * height * (0.35 + random() * 0.5), size: random() > 0.75 ? 6 : 3
  }));
  let destroyed = false;
  const game = new Phaser.Game({
    type: Phaser.CANVAS, parent, width, height, transparent: true, pixelArt: true, input: false,
    banner: false, audio: { noAudio: true },
    scene: {
      create(this: Phaser.Scene) {
        const graphics = this.add.graphics();
        const life = { progress: 0 };
        this.tweens.add({
          targets: life, progress: 1, duration: intense ? 1100 : 760, ease: 'Quad.easeOut',
          onUpdate: () => {
            graphics.clear();
            for (const pixel of pixels) {
              graphics.fillStyle(color, (1 - life.progress) * 0.75);
              graphics.fillRect(Math.round(pixel.x + pixel.dx * life.progress),
                Math.round(pixel.y + pixel.dy * life.progress), pixel.size, pixel.size);
            }
          },
          onComplete: dispose
        });
      }
    }
  });
  function dispose() {
    if (destroyed) return;
    destroyed = true;
    game.destroy(true);
  }
  return dispose;
}
