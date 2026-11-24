import Phaser from 'phaser';
import type { Platform } from '../config/settings';
import { clamp } from '../core/movement';
import type { GameSound } from '../ui/audio';
import type { CardFx, Impact, Racer, Run } from '../core/run';
import { mixColor, pixelRacer } from '../ui/pixels';


interface CourseOptions {
  race: Run;
  onUpdate: () => void;
  shake: () => boolean;
  playSound: (style: GameSound) => void;
  marketColors: () => { up: string; down: string };
}

class Course extends Phaser.Scene {
  private ink!: Phaser.GameObjects.Graphics;
  private labels = new Map<Racer, Phaser.GameObjects.Text>();
  private cameraTop = 0;
  private paintAt = 0;
  private lastNews = -1;
  private shakeEnds = 0;
  private shakeStrength = 0;
  private lastCardCue: Run['cardCue'] = null;
  private effectLabels = new Map<Racer, Phaser.GameObjects.Text>();
  private palette = new Map<string, number>();
  private gradients = new Map<string, string[]>();

  constructor(private readonly options: CourseOptions) {
    super('Course');
  }

  create() {
    const { race } = this.options;
    this.ink = this.add.graphics();
    this.cameraTop = this.desiredCamera();
    for (const racer of race.racers) {
      const label = this.add.text(0, 0, racer.character.name, {
        fontFamily: 'monospace, "PingFang TC", sans-serif',
        fontSize: '12px',
        fontStyle: 'bold',
        color: racer.isPlayer ? '#ffe298' : '#e0e9e9',
        backgroundColor: '#111a29',
        padding: { x: 4, y: 2 }
      }).setOrigin(.5, 1);
      this.labels.set(racer, label);
      this.effectLabels.set(racer, this.add.text(0, 0, '', {
        fontFamily: 'monospace, "PingFang TC", sans-serif', fontSize: '14px', fontStyle: 'bold',
        backgroundColor: '#131c2b', padding: { x: 4, y: 2 }
      }).setOrigin(.5, 1).setDepth(2).setVisible(false));
    }
    this.renderCourse(0);
  }

  update(time: number, delta: number) {
    const { race } = this.options;
    race.tick(Math.min(delta, 100));
    const goal = this.desiredCamera();
    this.cameraTop += (goal - this.cameraTop) * Math.min(1, delta / 160);
    this.renderCourse(time);
    if (time >= this.paintAt || race.result) {
      this.options.onUpdate();
      this.paintAt = time + 80;
    }
  }

  private desiredCamera() {
    const { race } = this.options;
    const height = race.config.theme.height;
    return clamp(this.visualPosition(race.player).y - height * .69, 0, race.track.map.height - height);
  }

  private rect(color: string, x: number, y: number, width: number, height: number, alpha = 1) {
    if (width > 0 && height > 0) {
      let ink = this.palette.get(color);
      if (ink === undefined) {
        ink = Number.parseInt(color.slice(1), 16);
        this.palette.set(color, ink);
      }
      this.ink.fillStyle(ink, alpha).fillRect(Math.round(x), Math.round(y), width, height);
    }
  }

  private renderCourse(time: number) {
    const { race } = this.options;
    const { width, height } = race.config.theme;
    const zone = race.track.zone(race.player.body.y);
    this.ink.clear();
    this.backdrop(width, height, zone.sky, zone.accent);
    if (race.news && race.news.at !== this.lastNews) {
      this.lastNews = race.news.at;
      if (race.news.tone === 'negative') this.shake(time, 3, 220);
    }
    if (race.cardCue && race.cardCue !== this.lastCardCue) {
      this.lastCardCue = race.cardCue;
      this.options.playSound(race.cardCue.style);
      if (race.cardCue.weight) this.shake(time, Math.min(8, 3 + race.cardCue.weight * 2), 320);
    }
    const offset = Math.round(this.cameraTop) + (time < this.shakeEnds
      ? Math.round(Math.sin(time * .085) * this.shakeStrength * Math.min(1, (this.shakeEnds - time) / 180)) : 0);
    const visible = (y: number, extension = 70) => y - offset >= -extension && y - offset <= height + extension;

    for (const ladder of race.track.map.ladders) {
      const lower = race.track.platforms.get(ladder.from)!;
      const upper = race.track.platforms.get(ladder.to)!;
      if (visible(lower.y, 150) || visible(upper.y, 150)) this.ladder(ladder.x, upper.y - offset, lower.y - offset);
    }
    for (const platform of race.track.map.platforms) {
      if (!visible(platform.y)) continue;
      this.platform(platform, platform.y - offset, platform.id === race.track.finish.id);
    }
    for (const ledge of race.track.ledges) {
      if (visible(ledge.y)) this.floatingBlock(ledge, ledge.y - offset);
    }

    for (const racer of [...race.racers].sort((a, b) => Number(a.isPlayer) - Number(b.isPlayer))) {
      const position = this.visualPosition(racer);
      const shown = visible(position.y, 24);
      const label = this.labels.get(racer)!;
      label.setVisible(shown);
      const effectLabel = this.effectLabels.get(racer)!;
      effectLabel.setVisible(false);
      if (shown) {
        this.racer(racer, position.x, position.y - offset, time, label);
        if (position.impact) this.drawImpact(position.impact, position.age, position.x, position.y - offset, effectLabel);
      }
    }
  }

  /** Racers share platforms, so each one stands in its own slot around the landing point. */
  private visualPosition(racer: Racer) {
    const { race } = this.options;
    const slot = (race.racers.indexOf(racer) - (race.racers.length - 1) / 2) * 26;
    const impact = race.impacts.get(racer);
    const x = racer.body.x + slot;
    if (!impact) return { x, y: racer.body.y, age: 0 };
    const age = (race.time - impact.at) / race.config.gameplay.effectAnimationMs;
    if (age >= 1) return { x, y: racer.body.y, age };
    const mix = impact.layers ? 1 - (1 - age) ** 3 : 1;
    return { x: impact.from.x + slot + (racer.body.x - impact.from.x) * mix, y: impact.from.y + (racer.body.y - impact.from.y) * mix, impact, age };
  }

  private shake(time: number, strength: number, duration: number) {
    if (!this.options.shake()) return;
    this.shakeStrength = strength;
    this.shakeEnds = time + duration;
  }

  private drawImpact(impact: Impact, age: number, x: number, y: number, label: Phaser.GameObjects.Text) {
    const palette: Record<CardFx, string> = {
      rise: this.options.marketColors().up, fall: this.options.marketColors().down, shield: '#96e6ff',
      speed: '#ffcf67', intel: '#c7a9ff', guard: '#adbfff', clear: '#bcf8bb', freeze: '#78caff', flat: '#cbd5d9'
    };
    const color = palette[impact.style];
    const alpha = 1 - age;
    const travel = age * 25;
    for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI / 4;
      const side = Math.cos(angle) * (11 + travel);
      const rise = Math.sin(angle) * (8 + travel / 2) + travel * Math.sign(impact.layers);
      if (impact.style === 'speed') {
        this.rect(color, x - 26 + (index % 2) * 24 + travel, y - 26 + (index % 4) * 7, 11, 2, alpha);
      } else if (impact.style === 'intel') {
        this.rect(color, x - 20 + index * 5, y - 23 - travel - (index % 3) * 4, 3, 2 + (index % 3) * 3, alpha);
      } else {
        const size = impact.style === 'shield' || impact.style === 'guard' ? 5 : impact.layers ? 4 : 3;
        this.rect(color, x + side, y - 17 + rise, size, size, alpha);
      }
    }
    if (impact.layers) {
      const head = y - 20 + (impact.layers > 0 ? -22 : 21);
      for (let step = 0; step < 4; step++) {
        this.rect(color, x - step * 2, head + step * Math.sign(impact.layers) * 2, 2 + step * 4, 2, alpha);
      }
    }
    label.setText(impact.label)
      .setPosition(clamp(Math.round(x + 34), 55, this.options.race.config.theme.width - 60), Math.round(y - 36 - travel))
      .setColor(color).setAlpha(Math.min(1, alpha * 2)).setVisible(true);
  }

  private floatingBlock(block: Platform, y: number) {
    this.rect('#102337', block.x, y, block.width, block.height);
    this.rect('#8acdd4', block.x + 1, y, block.width - 2, 3);
    this.rect('#476b87', block.x + 2, y + 4, block.width - 4, 5);
    for (let x = block.x + 7; x + 6 < block.x + block.width; x += 11) this.rect('#69aec0', x, y + 6, 5, 3);
  }

  private backdrop(width: number, height: number, sky: string, accent: string) {
    const parallax = this.cameraTop;
    let gradient = this.gradients.get(sky);
    if (!gradient) {
      gradient = Array.from({ length: Math.ceil(height / 4) }, (_, index) =>
        mixColor(sky, '#79a7bb', .08 + index * 4 / height * .16));
      this.gradients.set(sky, gradient);
    }
    for (const [index, color] of gradient.entries()) {
      const y = index * 4;
      this.rect(color, 0, y, width, 4);
      if (y % 16 === 0) this.rect('#bedbed', 0, y, width, 1, .025);
    }

    // 遠景與近景使用不同捲動速度，山路維持世界座標。
    for (let i = 0; i < 65; i++) {
      const x = (i * 83 + 17) % width;
      const y = ((i * 53 + Math.round(parallax * .12)) % (height + 25)) - 12;
      this.rect(i % 6 ? '#91abb7' : accent, x, y, i % 6 ? 2 : 3, 2, i % 6 ? .24 : .6);
    }
    for (let i = 0; i < 8; i++) {
      const x = (i * 211 + 27) % width - 35;
      const y = ((i * 73 + Math.round(parallax * .33)) % (height + 90)) - 55;
      this.rect('#7893ad', x + 12, y, 58, 7, .11);
      this.rect('#7893ad', x, y + 7, 92, 7, .13);
      this.rect('#7893ad', x + 20, y + 14, 56, 4, .09);
    }

    const colors = this.options.marketColors();
    for (let i = 0; i < 20; i++) {
      const x = 10 + i * 41;
      const y = ((i * 29 + Math.round(parallax * .25)) % (height + 50)) - 20;
      const rise = i % 5 < 3;
      const bar = rise ? colors.up : colors.down;
      this.rect(bar, x + 5, y - 17, 2, 66, .24);
      this.rect(bar, x, y, 12, 23 + i % 3 * 8, .18);
      this.rect(bar, x, y, 12, 2, .28);
    }

    for (let i = 0; i < 24; i++) {
      const x = i * 34 - 8;
      const heightVariation = 65 + (i * 73) % 114;
      const top = height - heightVariation + Math.round(parallax * .025) % 62;
      this.rect('#132438', x, top, 27, height - top, .6);
      this.rect('#15283a', x + 6, top - 6, 15, 6, .66);
      for (let row = top + 12; row + 5 < height; row += 13) {
        this.rect(accent, x + 6, row, 3, 4, (i + row) % 3 ? .14 : .28);
        this.rect('#b8bb9a', x + 15, row, 3, 4, (i + row) % 4 ? .16 : .05);
      }
    }
  }

  private platform(platform: Platform, y: number, finish: boolean) {
    const { x, width, layer, height } = platform;
    const gold = finish || (layer > 0 && layer % 5 === 0);
    this.rect('#101d27', x, y, width, height);
    this.rect(gold ? '#bd8248' : '#3e665b', x + 2, y + 2, width - 4, height - 5);
    this.rect(gold ? '#ffe28a' : '#b1d69a', x + 2, y, width - 4, 3);
    for (let left = x + 3; left + 14 < x + width; left += 27) {
      const tileWidth = Math.min(24, x + width - left - 2);
      this.rect(gold ? '#e0a85a' : '#79aa77', left, y + 5, tileWidth, 12);
      this.rect(gold ? '#f5cf74' : '#95bc89', left + 2, y + 6, tileWidth - 4, 2);
      this.rect(gold ? '#935f3b' : '#416e5c', left + 3, y + 13, tileWidth - 6, 3);
      this.rect(gold ? '#ffdb8b' : '#538169', left + 8, y + 9, 8, 4);
    }
    this.rect(gold ? '#604054' : '#263a43', x, y + height - 3, width, 3);

    if (finish) {
      const flag = platform.x + platform.width - 53;
      this.rect('#ffe38c', flag, y - 54, 4, 54);
      this.rect('#f5c96f', flag + 4, y - 52, 32, 16);
      this.rect('#bc754d', flag + 4, y - 40, 25, 5);
      for (let i = 0; i < 4; i++) this.rect('#f9e6ab', flag + 7 + i * 6, y - 49 + i % 2 * 5, 4, 4);
    }
  }

  private ladder(x: number, upperY: number, lowerY: number) {
    const height = lowerY - upperY;
    const rail = '#d4a266';
    this.rect('#402f36', x - 12, upperY + 2, 5, height);
    this.rect('#402f36', x + 7, upperY + 2, 5, height);
    for (let row = 7; row < height; row += 10) {
      this.rect(rail, x - 9, upperY + row, 18, 3);
      this.rect('#7c5145', x - 8, upperY + row + 3, 16, 2);
    }
    this.rect(rail, x - 10, upperY + 3, 3, height - 3);
    this.rect(rail, x + 7, upperY + 3, 3, height - 3);
  }

  private racer(racer: Racer, x: number, y: number, time: number, label: Phaser.GameObjects.Text) {
    const { race } = this.options;
    const impact = race.impacts.get(racer);
    const moving = impact && impact.layers !== 0 && race.time - impact.at < race.config.gameplay.effectAnimationMs;
    const step = moving ? (Math.floor(time / 115) % 2 ? -1 : 1) : 0;
    if (racer.status.shield > 0) {
      this.rect('#7bccec', x - 13, y - 29, 26, 27, .26);
      this.rect('#b9e7f1', x - 14, y - 31, 3, 4);
      this.rect('#b9e7f1', x + 11, y - 7, 3, 5);
    }
    const frozen = this.options.race.isFrozen(racer);
    pixelRacer((color, lx, ly, w, h) => this.rect(color, lx, ly, w, h),
      racer.character, Math.round(x / 2) * 2 - 12, Math.round(y / 2) * 2 - 30, 2,
      frozen ? 0 : step, racer.body.facing < 0);
    if (frozen) this.rect('#68ccf0', x - 13, y - 29, 26, 27, .45);
    label.setPosition(Math.round(x), Math.round(y - 34));
    if (racer.isPlayer) {
      this.rect('#ffe292', x - 5, y - 64, 10, 2);
      this.rect('#ffe292', x - 3, y - 62, 6, 2);
      this.rect('#ffe292', x - 1, y - 60, 2, 2);
    }
  }
}

export function mountCourse(parent: HTMLElement, options: CourseOptions) {
  const { width, height, night } = options.race.config.theme;
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width,
    height,
    backgroundColor: night,
    pixelArt: true,
    render: { antialias: false, roundPixels: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    audio: { noAudio: true },
    banner: false,
    scene: new Course(options)
  });
  return () => game.destroy(true);
}
