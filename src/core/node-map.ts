import { seededRandom, weighted, type Random } from './random';

export interface RouteNode {
  row: number;
  lane: number;
  kind: string;
  /** 下一交易日相連的路線索引。 */
  next: number[];
}

/** 每日各有一列節點，第一日可從任一路起步。 */
export interface NodeMap {
  lanes: number;
  rows: RouteNode[][];
}

interface NodeConfig {
  nodes: { lanes: number; maxLinks: number; attempts: number;
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

function kinds(row: number, lanes: number, config: NodeConfig, random: Random) {
  const pool = Object.entries(config.nodes.kinds)
    .filter(([, kind]) => kind.fromRow <= row)
    .map(([key, kind]) => ({ key, weight: kind.weight }));
  return Array.from({ length: lanes }, () => {
    const selection = weighted(pool, random);
    pool.splice(pool.indexOf(selection), 1);
    return selection.key;
  });
}

/** 檢查分岔路線的相鄰、可達與節點出現條件。 */
export function nodeMapProblems(map: NodeMap, config: NodeConfig) {
  const problems: string[] = [];
  const { lanes, rows } = map;
  if (lanes !== config.nodes.lanes) problems.push('路線數與設定不符');
  if (rows.length !== config.gameplay.turns) problems.push(`回合數 ${rows.length} 與設定 ${config.gameplay.turns} 不符`);
  for (const [row, nodes] of rows.entries()) {
    if (nodes.length !== lanes) problems.push(`第 ${row + 1} 回合節點數錯誤`);
    if (new Set(nodes.map(node => node.kind)).size !== nodes.length) problems.push(`第 ${row + 1} 日有重複類型`);
    for (const node of nodes) {
      const kind = config.nodes.kinds[node.kind];
      if (!kind) problems.push(`第 ${row + 1} 回合含未知節點 ${node.kind}`);
      else if (kind.fromRow > row) problems.push(`${node.kind} 不應出現在第 ${row + 1} 回合`);
      const last = row === rows.length - 1;
      if (node.next.length > config.nodes.maxLinks || (last && node.next.length > 0)) problems.push(`第 ${row + 1} 日連線數不符`);
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
        if (rows[row - 1][lane]?.next.includes(lane + 1) && rows[row - 1][lane + 1]?.next.includes(lane)) {
          problems.push(`第 ${row} 回合路線交叉`);
        }
      }
    }
  }
  return problems;
}

/** 以種子建立可重現的分岔圖，生成後立即驗證。 */
export function generateNodeMap(config: NodeConfig, seed: number): NodeMap {
  const { lanes, attempts } = config.nodes;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const random = seededRandom((seed ^ Math.imul(attempt + 1, 0x27d4eb2f)) >>> 0);
    const rows: RouteNode[][] = [];
    let directions: boolean[] = [];
    for (let row = 0; row < config.gameplay.turns; row++) {
      const types = kinds(row, lanes, config, random);
      directions = row % 2 ? directions.map(direction => !direction) :
        Array.from({ length: lanes - 1 }, () => random() < 0.5);
      const next = row === config.gameplay.turns - 1 ? types.map(() => []) : branchingLinks(lanes, directions, random);
      rows.push(types.map((kind, lane) => ({ row, lane, kind, next: next[lane] })));
    }
    const map = { lanes, rows };
    if (!nodeMapProblems(map, config).length) return map;
  }
  throw new Error('無法產生有效的路線圖，請檢查 finance.json 的節點類型與權重');
}
