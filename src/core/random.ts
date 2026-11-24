export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export type Random = ReturnType<typeof seededRandom>;

export function weighted<T extends { weight: number }>(list: T[], random: Random): T {
  let draw = random() * list.reduce((sum, item) => sum + item.weight, 0);
  return list.find(item => (draw -= item.weight) < 0) ?? list[list.length - 1];
}
