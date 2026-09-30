import {
  Connection,
  Graph,
  GraphNode,
  NodeKind
} from '../src/graph/types';
import { validateGraph } from '../src/graph/validate';

let seq = 0;

export function n(kind: NodeKind, extra?: Partial<GraphNode>): GraphNode {
  seq += 1;
  const id = extra && 'id' in extra && extra.id ? (extra as GraphNode).id : `t${seq}`;
  const base: GraphNode = { id, kind, position: { x: 0, y: 0 } } as GraphNode;
  if (kind === 'constFloat') {
    return { ...(base as Extract<GraphNode, { kind: 'constFloat' }>), value: 0.5 };
  }
  if (kind === 'constVec3') {
    return {
      ...(base as Extract<GraphNode, { kind: 'constVec3' }>),
      value: [0.1, 0.2, 0.3]
    };
  }
  return base;
}

let cseq = 0;
export function c(src: string, dst: string, dstPort: string): Connection {
  cseq += 1;
  return { id: `c${cseq}`, src, dst, dstPort };
}

export function graph(nodes: GraphNode[], connections: Connection[] = []): Graph {
  return { nodes, connections };
}

export function codes(g: Graph): Set<string> {
  return new Set(
    validateGraph(g)
      .diagnostics.filter((d) => d.severity === 'error')
      .map((d) => d.code)
  );
}

/** 构造“输出 <- 某 vec3 源”的最小合法图，返回各节点 id */
export function minimalValidGraph(): {
  g: Graph;
  out: string;
  vec: string;
} {
  const vecNode = n('constVec3');
  const out = n('output');
  const g = graph([vecNode, out], [c(vecNode.id, out.id, 'color')]);
  return { g, out: out.id, vec: vecNode.id };
}
