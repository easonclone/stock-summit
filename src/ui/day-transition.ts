/** 只負責播報開盤畫面，交易本身不等待動畫。 */
export class DayTransition {
  private overlay: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  play(day: number) {
    this.close();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const overlay = document.createElement('div');
    overlay.className = 'day-transition';
    overlay.setAttribute('aria-hidden', 'true');
    const label = document.createElement('strong');
    label.textContent = `DAY ${String(day).padStart(2, '0')}`;
    const subtitle = document.createElement('span');
    subtitle.textContent = '今日開盤';
    overlay.append(label, subtitle);
    overlay.addEventListener('animationend', () => this.close(), { once: true });
    this.root.append(overlay);
    this.overlay = overlay;
  }

  close() {
    this.overlay?.remove();
    this.overlay = null;
  }
}
