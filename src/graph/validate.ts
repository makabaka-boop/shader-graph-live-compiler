// 图校验：连线类型检查、可达子图环检测、必需输入检查
import {
  Connection,
  DataType,
  Graph,
  GraphNode,
  INPUT_PORTS,
  MAX_NODES,
  NodeKind,
  PortDef,
  outputType
} from './types';

export interface Diagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
  connectionId?: string;
}

export interface ValidationResult {
  diagnostics: Diagnostic[];
  /** 成功推导出输出类型的节点（add/mul 为推导出的具体类型） */
  resolvedTypes: Map<string, DataType>;
  /** 从颜色输出沿输出方向可达的节点集合；无输出节点时为空集 */
  reachable: Set<string>;
}

export function getNode(graph: Graph, id: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === id);
}

export function incomingConnections(graph: Graph, nodeId: string): Connection[] {
  return graph.connections.filter((c) => c.dst === nodeId);
}

export function connectionOnPort(graph: Graph, nodeId: string, port: string): Connection | undefined {
  return graph.connections.find((c) => c.dst === nodeId && c.dstPort === port);
}

export function outgoingConnections(graph: Graph, nodeId: string): Connection[] {
  return graph.connections.filter((c) => c.src === nodeId);
}

export function findOutputs(graph: Graph): GraphNode[] {
  return graph.nodes.filter((n) => n.kind === 'output');
}

/**
 * 类型推导。
 * @param extra 候选连线，视为已替换其目标端口上的旧连线（用于连线前预检）
 * 环安全：递归中再次遇到的节点返回 undefined，环由专门检测报告。
 */
class TypeResolver {
  private visit = new Map<string, 0 | 1>(); // 0=访问中 1=完成
  readonly types = new Map<string, DataType>();

  constructor(
    private graph: Graph,
    private extra?: Connection
  ) {}

  resolveAll(): Map<string, DataType> {
    for (const n of this.graph.nodes) this.resolve(n.id);
    return this.types;
  }

  private resolve(id: string): DataType | undefined {
    const node = getNode(this.graph, id);
    if (!node) return undefined;
    const st = this.visit.get(id);
    if (st === 1) return this.types.get(id);
    if (st === 0) return undefined; // 回边：环，类型未知

    this.visit.set(id, 0);
    const t = this.compute(node);
    this.visit.set(id, 1);
    if (t) this.types.set(id, t);
    return t;
  }

  private portConnection(nodeId: string, port: string): Connection | undefined {
    if (this.extra && this.extra.dst === nodeId && this.extra.dstPort === port) {
      return this.extra; // 候选连线视为已替换旧连线
    }
    return connectionOnPort(this.graph, nodeId, port);
  }

  private compute(node: GraphNode): DataType | undefined {
    const fixed = outputType(node.kind);
    if (fixed !== 'generic') return fixed;

    // add / mul：两端口类型须一致，结果取该类型；缺一个则取另一个
    const inferred: DataType[] = [];
    for (const p of INPUT_PORTS[node.kind]) {
      const conn = this.portConnection(node.id, p.name);
      if (!conn) continue;
      const srcType = this.resolve(conn.src);
      if (srcType) inferred.push(srcType);
    }
    if (inferred.length === 0) return undefined;
    return inferred.every((t) => t === inferred[0]) ? inferred[0] : undefined;
  }
}

export function resolveTypes(graph: Graph, extra?: Connection): Map<string, DataType> {
  return new TypeResolver(graph, extra).resolveAll();
}

/**
 * dst 是否能沿已有连线（输入方向）到达 src。
 * 若能，则再添加 src->dst 边必成环。
 */
export function reaches(graph: Graph, dst: string, src: string): boolean {
  if (dst === src) return true;
  const seen = new Set<string>([dst]);
  const stack = [dst];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of incomingConnections(graph, cur)) {
      if (c.src === src) return true;
      if (!seen.has(c.src)) {
        seen.add(c.src);
        stack.push(c.src);
      }
    }
  }
  return false;
}

/**
 * 从起点沿“数据流上游”（入边）收集所有能流入起点的节点。
 * 以颜色输出为起点时，得到的就是“输出可达子图”。
 */
export function reachableFrom(graph: Graph, startId: string | undefined): Set<string> {
  const result = new Set<string>();
  if (!startId || !getNode(graph, startId)) return result;
  result.add(startId);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const c of incomingConnections(graph, cur)) {
      if (!result.has(c.src) && getNode(graph, c.src)) {
        result.add(c.src);
        stack.push(c.src);
      }
    }
  }
  return result;
}

function portDef(node: GraphNode, portName: string): PortDef | undefined {
  return INPUT_PORTS[node.kind].find((p) => p.name === portName);
}

/** 输出节点没有输出端口 */
export function hasOutputPort(kind: NodeKind): boolean {
  return kind !== 'output';
}

export interface ConnectProposal {
  src: string;
  dst: string;
  dstPort: string;
}

/**
 * 连线前检查（UI 松拖时调用；Worker 对整图还会再校验一次）。
 * 返回 null 表示可以连接，否则返回中文错误信息。
 */
export function checkCanConnect(graph: Graph, proposal: ConnectProposal): string | null {
  const src = getNode(graph, proposal.src);
  const dst = getNode(graph, proposal.dst);
  if (!src || !dst) return '节点不存在';
  if (!hasOutputPort(src.kind)) return '颜色输出节点没有输出端口';
  const port = portDef(dst, proposal.dstPort);
  if (!port) return '目标输入端口不存在';
  if (proposal.src === proposal.dst) return '不允许自连';
  if (reaches(graph, proposal.dst, proposal.src)) return '连接会形成环';

  // 幂等：同一端口连同一来源，不产生变化
  const existing = connectionOnPort(graph, proposal.dst, proposal.dstPort);
  if (existing && existing.src === proposal.src) return null;

  const candidate: Connection = {
    id: '__candidate__',
    src: proposal.src,
    dst: proposal.dst,
    dstPort: proposal.dstPort
  };
  const types = resolveTypes(graph, candidate);
  const srcType = types.get(proposal.src);
  if (!srcType) return null; // 上游类型未知（如位于环上），交由整图校验报告

  if (port.type !== 'generic' && port.type !== srcType) {
    return `类型不匹配：端口需要 ${port.type}，来源是 ${srcType}`;
  }
  // add/mul 两个 generic 端口类型须一致
  if (dst.kind === 'add' || dst.kind === 'mul') {
    const otherPort = INPUT_PORTS[dst.kind].find((p) => p.name !== proposal.dstPort)!;
    const otherConn = connectionOnPort(graph, dst.id, otherPort.name);
    if (otherConn) {
      const otherType = types.get(otherConn.src);
      if (otherType && otherType !== srcType) {
        return `类型不匹配：另一输入为 ${otherType}，不能与 ${srcType} 混合`;
      }
    }
  }
  return null;
}

/**
 * 节点是否在“起点上游”某个环上（DFS 上色）。
 * 从起点沿入边向上游走；环上的回边会在灰色节点处被发现。
 */
function findCycleNodes(graph: Graph, reachable: Set<string>, start: string): Set<string> {
  const color = new Map<string, 0 | 1>();
  const inCycle = new Set<string>();

  const dfs = (id: string): boolean => {
    color.set(id, 0);
    let reachesCycle = false;
    for (const c of incomingConnections(graph, id)) {
      if (!reachable.has(c.src)) continue;
      const st = color.get(c.src);
      if (st === 0) {
        inCycle.add(c.src);
        reachesCycle = true;
      } else if (st === undefined && dfs(c.src)) {
        inCycle.add(c.src);
        reachesCycle = true;
      }
    }
    color.set(id, 1);
    return reachesCycle;
  };
  dfs(start);
  return inCycle;
}

const KIND_LABEL: Record<NodeKind, string> = {
  constFloat: '浮点常量',
  constVec3: '三分量常量',
  uv: 'UV',
  time: '时间',
  add: '加',
  mul: '乘',
  lerp: '插值',
  output: '颜色输出'
};

/** 整图校验：只对颜色输出可达子图报错（断开的节点不影响输出） */
export function validateGraph(graph: Graph): ValidationResult {
  const diagnostics: Diagnostic[] = [];

  if (graph.nodes.length > MAX_NODES) {
    diagnostics.push({
      code: 'too-many-nodes',
      severity: 'error',
      message: `节点数 ${graph.nodes.length} 超过上限 ${MAX_NODES}`
    });
  }

  const outputs = findOutputs(graph);
  let outputId: string | undefined;
  if (outputs.length === 0) {
    diagnostics.push({
      code: 'missing-output',
      severity: 'error',
      message: '缺少颜色输出节点'
    });
  } else {
    if (outputs.length > 1) {
      for (let i = 1; i < outputs.length; i++) {
        diagnostics.push({
          code: 'multiple-outputs',
          severity: 'error',
          message: '只能有一个颜色输出节点',
          nodeId: outputs[i].id
        });
      }
    }
    outputId = outputs[0].id;
  }

  // 悬空连线（引用已删除节点）
  for (const c of graph.connections) {
    if (!getNode(graph, c.src) || !getNode(graph, c.dst)) {
      diagnostics.push({
        code: 'dangling-edge',
        severity: 'error',
        message: '存在引用已删除节点的连线',
        connectionId: c.id
      });
    }
  }

  const reachable = reachableFrom(graph, outputId);
  const resolvedTypes = resolveTypes(graph);

  // 环检测：仅输出可达子图
  const cycleNodes = outputId
    ? findCycleNodes(graph, reachable, outputId)
    : new Set<string>();
  for (const id of cycleNodes) {
    diagnostics.push({
      code: 'cycle',
      severity: 'error',
      message: '输出可达子图中存在环',
      nodeId: id
    });
  }

  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) continue;

    const portTypes: DataType[] = [];
    for (const port of INPUT_PORTS[node.kind]) {
      const conn = connectionOnPort(graph, node.id, port.name);
      if (!conn) {
        diagnostics.push({
          code: 'missing-input',
          severity: 'error',
          message: `「${KIND_LABEL[node.kind]}」的输入「${port.label}」未连接`,
          nodeId: node.id
        });
        continue;
      }
      const srcNode = getNode(graph, conn.src);
      if (!srcNode) continue; // dangling-edge 已报告
      const srcType = resolvedTypes.get(conn.src);
      if (!srcType) continue; // 环上节点无法推导，环错误已报告

      if (port.type !== 'generic') {
        if (port.type !== srcType) {
          diagnostics.push({
            code: 'type-mismatch',
            severity: 'error',
            message: `「${KIND_LABEL[node.kind]}」的输入「${port.label}」需要 ${port.type}，但来源是 ${srcType}`,
            nodeId: node.id,
            connectionId: conn.id
          });
        }
      } else {
        portTypes.push(srcType);
      }
    }

    // add/mul 两端口类型一致性（环上跳过，避免噪声）
    if ((node.kind === 'add' || node.kind === 'mul') && !cycleNodes.has(node.id)) {
      if (portTypes.length > 1 && !portTypes.every((t) => t === portTypes[0])) {
        diagnostics.push({
          code: 'generic-mismatch',
          severity: 'error',
          message: `「${KIND_LABEL[node.kind]}」两个输入的类型不一致（${portTypes.join(' 与 ')}）`,
          nodeId: node.id
        });
      }
    }
  }

  return { diagnostics, resolvedTypes, reachable };
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error');
}
