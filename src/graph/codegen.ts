// 输出可达子图的拓扑排序与 GLSL 片段着色器生成
import {
  Connection,
  DataType,
  Graph,
  GraphNode
} from './types';
import {
  Diagnostic,
  connectionOnPort,
  getNode,
  incomingConnections,
  reachableFrom,
  validateGraph
} from './validate';

export interface BuildResult {
  ok: boolean;
  /** 与图修订对应的版本号，由调用方填入 */
  revision?: number;
  diagnostics: Diagnostic[];
  vertexShader?: string;
  fragmentShader?: string;
  /** 输出可达子图的拓扑序（输出节点在末尾） */
  order?: string[];
}

/**
 * 对输出可达子图做拓扑排序（Kahn 算法）。
 * 入度只统计可达子图内部的连线。
 * 返回 null 表示存在环（调用前通常已校验，这里做防御）。
 */
export function topologicalOrder(graph: Graph, outputId: string): string[] | null {
  const reachable = reachableFrom(graph, outputId);
  const indegree = new Map<string, number>();
  for (const id of reachable) indegree.set(id, 0);

  for (const id of reachable) {
    // 每个上游 -> id 计为 id 的一条入边
    const n = incomingConnections(graph, id).filter((c) => reachable.has(c.src)).length;
    indegree.set(id, n);
  }

  // 从入度 0 的源（常量/UV/时间）开始；平局按节点在图中的插入序，保证稳定
  const indexById = new Map(graph.nodes.map((node, i) => [node.id, i]));
  const queue = [...reachable]
    .filter((id) => (indegree.get(id) ?? 0) === 0)
    .sort((a, b) => (indexById.get(a) ?? 0) - (indexById.get(b) ?? 0));

  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const c of graph.connections) {
      if (c.src !== id || !reachable.has(c.dst)) continue;
      const d = (indegree.get(c.dst) ?? 0) - 1;
      indegree.set(c.dst, d);
      if (d === 0) queue.push(c.dst);
    }
  }
  return order.length === reachable.size ? order : null;
}

export const VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

function formatFloat(v: number): string {
  if (!Number.isFinite(v)) return '0.0';
  const s = Number(v).toFixed(6).replace(/\.?0+$/, '');
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** 生成某输入端口上的 GLSL 表达式（含必要的类型转换） */
function inputExpr(
  graph: Graph,
  node: GraphNode,
  port: string,
  expected: DataType,
  varOf: (id: string) => string,
  resolved: Map<string, DataType>
): string {
  const conn: Connection | undefined = connectionOnPort(graph, node.id, port);
  if (!conn) throw new Error(`internal: 端口 ${node.id}.${port} 未连接`);
  const raw = `${varOf(conn.src)}`;
  const srcType = resolved.get(conn.src);
  if (!srcType) throw new Error(`internal: 来源 ${conn.src} 类型未解析`);
  if (srcType === expected) return raw;
  if (expected === 'vec3' && srcType === 'float') return `vec3(${raw})`;
  // vec3 -> float 的窄化不应通过类型检查；防御性取 r 分量
  return `${raw}.r`;
}

export function buildShaders(graph: Graph): BuildResult {
  const validation = validateGraph(graph);
  if (validation.diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics: validation.diagnostics };
  }

  const output = graph.nodes.find((n) => n.kind === 'output')!;
  const reachable = validation.reachable;
  const order = topologicalOrder(graph, output.id);
  if (!order) {
    return {
      ok: false,
      diagnostics: [
        { code: 'cycle', severity: 'error', message: '输出可达子图中存在环（拓扑排序失败）' }
      ]
    };
  }

  // 拓扑序中的稳定下标 -> GLSL 变量名
  const varById = new Map<string, string>();
  order.forEach((id, i) => varById.set(id, `n${i}`));
  const varOf = (id: string) => varById.get(id) ?? id;

  // 校验通过后 add/mul 的具体类型必然可推导
  const resolved = validation.resolvedTypes;

  const lines: string[] = [];
  for (const id of order) {
    const node = getNode(graph, id)!;
    const v = varOf(id);
    switch (node.kind) {
      case 'constFloat':
        lines.push(`  float ${v} = ${formatFloat(node.value)};`);
        break;
      case 'constVec3': {
        const [r, g, b] = node.value;
        lines.push(
          `  vec3 ${v} = vec3(${formatFloat(r)}, ${formatFloat(g)}, ${formatFloat(b)});`
        );
        break;
      }
      case 'uv':
        lines.push(`  vec3 ${v} = vec3(v_uv, 0.0);`);
        break;
      case 'time':
        lines.push(`  float ${v} = u_time;`);
        break;
      case 'add':
      case 'mul': {
        const t = resolved.get(node.id) ?? 'vec3';
        const op = node.kind === 'add' ? '+' : '*';
        const a = inputExpr(graph, node, 'a', t, varOf, resolved);
        const b = inputExpr(graph, node, 'b', t, varOf, resolved);
        lines.push(`  ${t} ${v} = (${a}) ${op} (${b});`);
        break;
      }
      case 'lerp': {
        const a = inputExpr(graph, node, 'a', 'vec3', varOf, resolved);
        const b = inputExpr(graph, node, 'b', 'vec3', varOf, resolved);
        const t = inputExpr(graph, node, 't', 'float', varOf, resolved);
        lines.push(`  vec3 ${v} = mix(${a}, ${b}, ${t});`);
        break;
      }
      case 'output': {
        const color = inputExpr(graph, node, 'color', 'vec3', varOf, resolved);
        lines.push(`  vec3 ${v} = ${color};`);
        break;
      }
    }
  }

  const outVar = varOf(output.id);
  const fragmentShader = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform float u_time;
out vec4 fragColor;
void main() {
${lines.join('\n')}
  fragColor = vec4(clamp(${outVar}, 0.0, 1.0), 1.0);
}
`;

  return {
    ok: true,
    diagnostics: validation.diagnostics.filter((d) => d.severity === 'warning'),
    vertexShader: VERTEX_SHADER,
    fragmentShader,
    order
  };
}

/** Worker 消息载荷（主线程 <-> worker 共享协议） */
export interface BuildRequest {
  type: 'build';
  revision: number;
  graph: Graph;
}

export type BuildResponse =
  | { type: 'buildResult'; revision: number; result: BuildResult }
  | { type: 'buildError'; revision: number; message: string };
