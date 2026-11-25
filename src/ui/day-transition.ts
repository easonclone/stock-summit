/** 只負責播報開盤畫面，交易本身不等待動畫。 */
export class DayTransition {
  private overlay: HTMLElement | null = null;

  constructor(private readonly root: HTMLElement) {}

  get active() {
    return this.overlay !== null;
  }

  /** 延後開盤演出，讓戰場結算先播完。 */
  play(day: number, after = 0, onFinish?: () => void) {
    this.close();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const overlay = document.createElement('div');
    overlay.className = 'day-transition';
    overlay.setAttribute('aria-hidden', 'true');
    if (after) overlay.style.animationDelay = `${420 + after}ms`;
    const label = document.createElement('strong');
    label.textContent = `DAY ${String(day).padStart(2, '0')}`;
    const subtitle = document.createElement('span');
    subtitle.textContent = '今日開盤';
    overlay.append(label, subtitle);
    overlay.addEventListener('animationend', () => {
      this.close();
      onFinish?.();
    }, { once: true });
    this.root.append(overlay);
    this.overlay = overlay;
  }

  close() {
    this.overlay?.remove();
    this.overlay = null;
  }
}
