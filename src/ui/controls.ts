import type { MovementInput } from '../core/movement';

const movementKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'Space']);

export class Controls {
  private readonly held = new Set<string>();
  private jump = false;

  hold(code: string) {
    if (!movementKeys.has(code)) return false;
    if (code === 'Space' && !this.held.has(code)) this.jump = true;
    this.held.add(code);
    return true;
  }

  release(code: string) {
    this.held.delete(code);
  }

  clear() {
    this.held.clear();
    this.jump = false;
  }

  read(): MovementInput {
    const active = (first: string, second: string) => this.held.has(first) || this.held.has(second);
    const result: MovementInput = {
      horizontal: (Number(active('ArrowRight', 'KeyD')) - Number(active('ArrowLeft', 'KeyA'))) as MovementInput['horizontal'],
      vertical: (Number(active('ArrowDown', 'KeyS')) - Number(active('ArrowUp', 'KeyW'))) as MovementInput['vertical'],
      jump: this.jump
    };
    this.jump = false;
    return result;
  }
}
