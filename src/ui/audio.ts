export type GameSound = 'rise' | 'fall' | 'shield' | 'flat' | 'impact' | 'combo' | 'rank' | 'alarm'
  | 'breaking' | 'chime' | 'fanfare' | 'gavel' | 'bell' | 'phone' | 'notify' | 'siren' | 'blip' | 'page'
  | 'hit' | 'hit_strong' | 'hit_heavy' | 'block' | 'shatter' | 'counter' | 'coin' | 'joker' | 'chain' | 'overtake';
const notes: Record<GameSound, number[]> = {
  rise: [330, 440, 660, 880], fall: [440, 270, 147], shield: [440, 554, 660],
  flat: [220], impact: [115, 62],
  combo: [523, 659, 784, 1047, 1319], rank: [392, 523, 784], alarm: [880, 660, 880, 660],
  breaking: [784, 988, 784, 1175], chime: [659, 880], fanfare: [523, 659, 784, 1047, 784, 1047], gavel: [196, 98, 196],
  bell: [1319, 988, 1319, 988], phone: [1047, 1319, 1047, 1319, 1047], notify: [1175, 1568], siren: [440, 880, 440, 880, 440, 880],
  blip: [1568], page: [880, 1175],
  hit: [220, 147], hit_strong: [262, 147, 98], hit_heavy: [330, 131, 82, 55],
  block: [988, 1319], shatter: [1760, 1175, 1568, 784], counter: [659, 988, 1319],
  coin: [1568, 2093, 1760], joker: [784], chain: [784, 1047], overtake: [523, 659, 784, 1047]
};
const wave: Partial<Record<GameSound, OscillatorType>> = {
  fall: 'sawtooth', impact: 'sawtooth', alarm: 'sawtooth', siren: 'sawtooth', gavel: 'sawtooth',
  hit: 'square', hit_strong: 'sawtooth', hit_heavy: 'sawtooth', shield: 'triangle', block: 'triangle', counter: 'triangle',
  coin: 'triangle', joker: 'triangle', chain: 'triangle'
};
const quiet = new Set<GameSound>(['blip', 'joker']);

/**
 * Short square/saw blips through one compressor, so many effects firing together never stack into a loud burst.
 * The same sound is not retriggered within 45 ms, and at most four sounds start inside any 120 ms window.
 */
export class CardAudio {
  enabled = true;
  private context?: AudioContext;
  private output?: AudioNode;
  private last = new Map<GameSound, number>();
  private recent: number[] = [];

  unlock() {
    if (!this.enabled || typeof AudioContext === 'undefined') return;
    try {
      this.context ??= new AudioContext();
      if (!this.output) {
        const limiter = this.context.createDynamicsCompressor();
        limiter.threshold.value = -18;
        limiter.knee.value = 6;
        limiter.ratio.value = 8;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.12;
        const master = this.context.createGain();
        master.gain.value = 0.9;
        limiter.connect(master).connect(this.context.destination);
        this.output = limiter;
      }
      void this.context.resume().catch(() => {});
    } catch {
      return;
    }
  }

  /** `pitch` multiplies every note (used for the rising joker chain). */
  play(style: GameSound, pitch = 1) {
    const context = this.context;
    if (!this.enabled || context?.state !== 'running' || !this.output) return;
    const now = context.currentTime;
    if (now - (this.last.get(style) ?? -1) < 0.045) return;
    this.recent = this.recent.filter(time => now - time < 0.12);
    if (this.recent.length >= 4) return;
    this.recent.push(now);
    this.last.set(style, now);
    const heavy = style === 'hit_heavy' || style === 'hit_strong';
    for (const [index, frequency] of notes[style].entries()) {
      const start = now + index * (heavy ? 0.04 : 0.054);
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.type = wave[style] ?? 'square';
      tone.frequency.value = frequency * pitch;
      const length = heavy ? 0.12 : 0.09;
      volume.gain.setValueAtTime(0.001, start);
      volume.gain.linearRampToValueAtTime(quiet.has(style) ? 0.03 : heavy ? 0.07 : 0.055, start + 0.012);
      volume.gain.exponentialRampToValueAtTime(0.001, start + length);
      tone.connect(volume).connect(this.output);
      tone.start(start);
      tone.stop(start + length + 0.005);
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
    }
  }
}
