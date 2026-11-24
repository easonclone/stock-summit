import type { CardFx } from '../core/run';

export type GameSound = CardFx | 'impact';

const notes: Record<GameSound, number[]> = {
  rise: [330, 440, 660, 880], fall: [440, 270, 147], shield: [440, 554, 660],
  speed: [330, 440, 550, 660], intel: [720, 540, 790], guard: [300, 300, 440],
  clear: [420, 680, 840], freeze: [640, 410, 230], flat: [220], impact: [115, 62]
};

export class CardAudio {
  enabled = true;
  private context?: AudioContext;

  unlock() {
    if (!this.enabled || typeof AudioContext === 'undefined') return;
    try {
      this.context ??= new AudioContext();
      void this.context.resume().catch(() => {});
    } catch {
      return;
    }
  }

  play(style: GameSound) {
    const context = this.context;
    if (!this.enabled || context?.state !== 'running') return;
    const now = context.currentTime;
    for (const [index, frequency] of notes[style].entries()) {
      const start = now + index * .054;
      const tone = context.createOscillator();
      const volume = context.createGain();
      tone.type = style === 'fall' || style === 'freeze' || style === 'impact' ? 'sawtooth' : style === 'shield' || style === 'clear' ? 'triangle' : 'square';
      tone.frequency.value = frequency;
      volume.gain.setValueAtTime(.001, start);
      volume.gain.linearRampToValueAtTime(.055, start + .012);
      volume.gain.exponentialRampToValueAtTime(.001, start + .09);
      tone.connect(volume).connect(context.destination);
      tone.start(start);
      tone.stop(start + .095);
      tone.onended = () => { tone.disconnect(); volume.disconnect(); };
    }
  }
}
