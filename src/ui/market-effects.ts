import Phaser from 'phaser';
import { seededRandom } from '../core/random';

export function mountMarketEffect(parent: HTMLElement, seed: number, color: number, intense: boolean) {
  const random = seededRandom(seed);
  const pixels = Array.from({ length: intense ? 28 : 16 }, () => ({
    x: 60 + random() * 112, y: 13 + random() * 27,
    dx: (random() - 0.25) * 70, dy: (random() - 0.5) * 58, size: random() > 0.75 ? 5 : 3
  }));
  let destroyed = false;
  const game = new Phaser.Game({
    type: Phaser.CANVAS, parent, width: 212, height: 56, transparent: true, pixelArt: true, input: false,
    banner: false, audio: { noAudio: true },
    scene: {
      create(this: Phaser.Scene) {
        const graphics = this.add.graphics();
        const life = { progress: 0 };
        this.tweens.add({
          targets: life, progress: 1, duration: 560, ease: 'Quad.easeOut',
          onUpdate: () => {
            graphics.clear();
            for (const pixel of pixels) {
              graphics.fillStyle(color, (1 - life.progress) * 0.58);
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
