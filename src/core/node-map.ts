import { seededRandom, weighted, type Random } from './random';

export interface RouteNode {
  row: number;
  lane: number;
  kind: string;
  /** Lanes in the next row this node leads to. */
  next: number[];
}

/** rows[row][lane]; every row has one node per lane. Racers start below row 0 and may enter any row-0 node. */
export interface NodeMap {
  lanes: number;
  rows: RouteNode[][];
}

interface NodeConfig {
  nodes: { lanes: number; maxLinks: number; attempts: number; diverse?: true;
    kinds: Record<string, { fromRow: number; weight: number }> };
  gameplay: { turns: number };
}

function branchingLinks(lanes: number, directions: boolean[], random: Random) {
  return Array.from({ length: lanes }, (_, lane) => {
    const neighbors = [lane - 1, lane + 1].filter(next => next >= 0 && next < lanes &&
      (next < lane ? !directions[next] : directions[lane]));
    const branch = neighbors[Math.floor(random() * neighbors.length)];
    return branch === undefined ? [lane] : [lane, branch].sort((a, b) => a - b);
  });
}

function links(lanes: number, maxLinks: number, random: Random) {
  // Each lane links to 1..maxLinks of its neighbours (lane-1, lane, lane+1) without crossing paths,
  // and every lane of the next row keeps at least one incoming link.
  const result: number[][] = Array.from({ length: lanes }, () => []);
  for (let lane = 0; lane < lanes; lane++) {
    const options = [lane - 1, lane, lane + 1].filter(next => next >= 0 && next < lanes);
    const count = 1 + Math.floor(random() * Math.min(maxLinks, options.length));
    const picked = [...options].sort(() => random() - .5).slice(0, count);
    result[lane] = picked.sort((a, b) => a - b);
  }
  for (let lane = 0; lane < lanes - 1; lane++) {
    // A crossing is lane→lane+1 together with lane+1→lane; keep the straight links instead.
    if (result[lane].includes(lane + 1) && result[lane + 1].includes(lane)) {
      result[lane] = result[lane].filter(next => next !== lane + 1);
      if (!result[lane].includes(lane)) result[lane].push(lane);
      result[lane + 1] = result[lane + 1].filter(next => next !== lane);
      if (!result[lane + 1].includes(lane + 1)) result[lane + 1].push(lane + 1);
    }
  }
  for (let next = 0; next < lanes; next++) {
    if (!result.some(targets => targets.includes(next))) result[next].push(next);
  }
  return result.map(targets => [...new Set(targets)].sort((a, b) => a - b));
}

function kinds(row: number, lanes: number, config: NodeConfig, random: Random) {
  const pool = Object.entries(config.nodes.kinds)
    .filter(([, kind]) => kind.fromRow <= row)
    .map(([key, kind]) => ({ key, weight: kind.weight }));
  return Array.from({ length: lanes }, () => {
    const selection = weighted(pool, random);
    if (config.nodes.diverse) pool.splice(pool.indexOf(selection), 1);
    return selection.key;
  });
}

/** Problems with a node map, empty when it is playable. */
export function nodeMapProblems(map: NodeMap, config: NodeConfig) {
  const problems: string[] = [];
  const { lanes, rows } = map;
  if (rows.length !== config.gameplay.turns) problems.push(`回合數 ${rows.length} 與設定 ${config.gameplay.turns} 不符`);
  for (const [row, nodes] of rows.entries()) {
    if (nodes.length !== lanes) problems.push(`第 ${row + 1} 回合節點數錯誤`);
    if (new Set(nodes.map(node => node.kind)).size < 2) problems.push(`第 ${row + 1} 回合只有一種節點`);
    for (const node of nodes) {
      const kind = config.nodes.kinds[node.kind];
      if (!kind) problems.push(`第 ${row + 1} 回合含未知節點 ${node.kind}`);
      else if (kind.fromRow > row) problems.push(`${node.kind} 不應出現在第 ${row + 1} 回合`);
      const last = row === rows.length - 1;
      if (!last && !node.next.length) problems.push(`第 ${row + 1} 回合第 ${node.lane + 1} 路是死路`);
      if (node.next.some(next => Math.abs(next - node.lane) > 1 || next < 0 || next >= lanes)) {
        problems.push(`第 ${row + 1} 回合第 ${node.lane + 1} 路連到不相鄰的路`);
      }
    }
    if (row > 0) {
      for (let lane = 0; lane < lanes; lane++) {
        if (!rows[row - 1].some(node => node.next.includes(lane))) problems.push(`第 ${row + 1} 回合第 ${lane + 1} 路無法抵達`);
      }
      for (let lane = 0; lane < lanes - 1; lane++) {
        if (rows[row - 1][lane].next.includes(lane + 1) && rows[row - 1][lane + 1].next.includes(lane)) {
          problems.push(`第 ${row} 回合路線交叉`);
        }
      }
    }
  }
  return problems;
}

/** Builds a reproducible branching route map for `seed`, retrying until it passes `nodeMapProblems`. */
export function generateNodeMap(config: NodeConfig, seed: number): NodeMap {
  const { lanes, maxLinks, attempts, diverse } = config.nodes;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const random = seededRandom((seed ^ Math.imul(attempt + 1, 0x27d4eb2f)) >>> 0);
    const rows: RouteNode[][] = [];
    let directions: boolean[] = [];
    for (let row = 0; row < config.gameplay.turns; row++) {
      const types = kinds(row, lanes, config, random);
      if (diverse) {
        directions = row % 2 ? directions.map(direction => !direction) :
          Array.from({ length: lanes - 1 }, () => random() < 0.5);
      }
      const next = row === config.gameplay.turns - 1 ? types.map(() => []) :
        diverse ? branchingLinks(lanes, directions, random) : links(lanes, maxLinks, random);
      rows.push(types.map((kind, lane) => ({ row, lane, kind, next: next[lane] })));
    }
    const map = { lanes, rows };
    if (!nodeMapProblems(map, config).length) return map;
  }
  throw new Error('無法產生有效的路線圖，請檢查 nodes.json 的節點類型與權重');
}
