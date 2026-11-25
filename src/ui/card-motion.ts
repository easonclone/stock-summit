/**
 * Physical card motion, purely decorative: a card snapshot (a clone with its canvases copied) is taken before the
 * screen re-renders, then flies to a target or shatters on a fixed overlay. Nothing here touches game state, and
 * with reduced motion every call is a no-op.
 */
export interface CardSnapshot { node: HTMLElement; rect: DOMRect }

const DECK_EASE = 'cubic-bezier(.2,.85,.3,1)';

function copyCanvases(source: HTMLElement, clone: HTMLElement) {
  const from = source.querySelectorAll('canvas');
  clone.querySelectorAll('canvas').forEach((canvas, index) => {
    const original = from[index];
    if (!original) return;
    canvas.width = original.width;
    canvas.height = original.height;
    canvas.getContext('2d')?.drawImage(original, 0, 0);
  });
}

/** Freeze how one card looks right now, before a re-render throws its element away. */
export function snapshotCard(element: Element | null): CardSnapshot | null {
  if (!(element instanceof HTMLElement)) return null;
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const node = element.cloneNode(true) as HTMLElement;
  copyCanvases(element, node);
  node.removeAttribute('data-act');
  node.setAttribute('aria-hidden', 'true');
  node.querySelectorAll('[data-act]').forEach(child => child.removeAttribute('data-act'));
  return { node, rect };
}

function overlay(snapshot: CardSnapshot, clip?: string) {
  const node = snapshot.node.cloneNode(true) as HTMLElement;
  copyCanvases(snapshot.node, node);
  const { rect } = snapshot;
  Object.assign(node.style, {
    position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`,
    margin: '0', zIndex: '90', pointerEvents: 'none', transform: 'none', clipPath: clip ?? ''
  });
  node.classList.add('card-ghost');
  // Inside #app so the card keeps its themed styles; fixed position keeps it above everything.
  (document.querySelector('#app') ?? document.body).append(node);
  return node;
}

const centre = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

/** The card flies into a fighter (or any element) and is absorbed there. */
export function flyCard(snapshot: CardSnapshot | null, target: Element | null, delay = 0) {
  if (!snapshot || !target) return;
  const node = overlay(snapshot);
  const from = centre(snapshot.rect);
  const to = centre(target.getBoundingClientRect());
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lift = Math.min(-40, dy / 2 - 30);
  const animation = node.animate([
    { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.45}px, ${lift}px) rotate(${dx > 0 ? 8 : -8}deg) scale(.82)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) rotate(${dx > 0 ? 18 : -18}deg) scale(.28)`, opacity: 0 }
  ], { duration: 460, delay, easing: DECK_EASE, fill: 'both' });
  animation.onfinish = () => node.remove();
}

/** The card breaks into pixel shards (discarded or replaced). */
export function shatterCard(snapshot: CardSnapshot | null) {
  if (!snapshot) return;
  const pieces = [
    'polygon(0 0,55% 0,40% 45%,0 35%)', 'polygon(55% 0,100% 0,100% 40%,40% 45%)', 'polygon(0 35%,40% 45%,30% 100%,0 100%)',
    'polygon(40% 45%,100% 40%,100% 75%,60% 70%)', 'polygon(40% 45%,60% 70%,65% 100%,30% 100%)', 'polygon(60% 70%,100% 75%,100% 100%,65% 100%)'
  ];
  pieces.forEach((clip, index) => {
    const node = overlay(snapshot, clip);
    const angle = (index / pieces.length) * Math.PI * 2 - Math.PI / 2;
    const reach = 34 + (index % 3) * 14;
    const animation = node.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1, filter: 'brightness(1.6)' },
      { transform: `translate(${Math.cos(angle) * reach}px, ${Math.sin(angle) * reach + 30}px) rotate(${index % 2 ? 24 : -24}deg)`, opacity: 0, filter: 'brightness(1)' }
    ], { duration: 420, easing: 'cubic-bezier(.3,.6,.4,1)', fill: 'both' });
    animation.onfinish = () => node.remove();
  });
}

/** A card that just entered the hand slides in from the deck at the bottom left, with a short stagger. */
export function drawCard(element: Element | null, index = 0) {
  if (!(element instanceof HTMLElement)) return;
  element.animate([
    { transform: 'translate(-70vw, 40px) rotate(-16deg) scale(.55)', opacity: 0 },
    { transform: 'translate(6px, -6px) rotate(2deg) scale(1.04)', opacity: 1, offset: 0.75 },
    { transform: 'none', opacity: 1 }
  ], { duration: 420, delay: index * 90, easing: DECK_EASE, fill: 'backwards' });
}
