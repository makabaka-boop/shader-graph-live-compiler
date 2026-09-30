// 编辑器状态：图数据 + 修订号。
// revision 仅在“会影响编译结果”的编辑（结构 / 常量值）时 +1；
// 单纯移动节点位置不影响着色器，使用单独的 positionsVersion 驱动渲染。
import {
  Connection,
  Graph,
  GraphNode,
  MAX_NODES,
  NodeKind
} from '../graph/types';
import {
  checkCanConnect,
  connectionOnPort,
  findOutputs
} from '../graph/validate';

export interface EditorState {
  graph: Graph;
  /** 当前编辑修订（单调递增），Worker / 编译 / 导出都以它为准 */
  revision: number;
  selectedNodeId: string | null;
  /** 最近一次连线被拒绝的提示（瞬时状态，UI 显示后可清除） */
  connectError: string | null;
}

export type EditorAction =
  | { type: 'addNode'; node: GraphNode }
  | { type: 'moveNode'; id: string; x: number; y: number }
  | {
      type: 'connect';
      src: string;
      dst: string;
      dstPort: string;
    }
  | { type: 'disconnect'; connectionId: string }
  | { type: 'deleteNode'; id: string }
  | { type: 'setFloat'; id: string; value: number }
  | { type: 'setVec3'; id: string; value: [number, number, number] }
  | { type: 'select'; id: string | null }
  | { type: 'clearConnectError' }
  | { type: 'replaceGraph'; graph: Graph; revision?: number };

export function newId(prefix = 'id'): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

function bumpForStructure(graph: Graph, kind: NodeKind): string | null {
  if (graph.nodes.length >= MAX_NODES) {
    return `节点数已达上限 ${MAX_NODES}`;
  }
  if (kind === 'output' && findOutputs(graph).length >= 1) {
    return '只能存在一个颜色输出节点';
  }
  return null;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'addNode': {
      const blocked = bumpForStructure(state.graph, action.node.kind);
      if (blocked) return { ...state, connectError: blocked };
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: [...state.graph.nodes, action.node]
        },
        revision: state.revision + 1,
        selectedNodeId: action.node.id,
        connectError: null
      };
    }

    case 'moveNode': {
      // 位置不影响编译结果：不增加 revision
      const nodes = state.graph.nodes.map((n) =>
        n.id === action.id ? { ...n, position: { x: action.x, y: action.y } } : n
      );
      return { ...state, graph: { ...state.graph, nodes } };
    }

    case 'connect': {
      const err = checkCanConnect(state.graph, {
        src: action.src,
        dst: action.dst,
        dstPort: action.dstPort
      });
      if (err) return { ...state, connectError: err };

      // 幂等：完全相同的连线不产生修订
      const existing = connectionOnPort(state.graph, action.dst, action.dstPort);
      if (existing && existing.src === action.src) {
        return { ...state, connectError: null };
      }

      // 同一输入端口单连线：替换旧连线
      const kept = state.graph.connections.filter(
        (c) => !(c.dst === action.dst && c.dstPort === action.dstPort)
      );
      const conn: Connection = {
        id: newId('c'),
        src: action.src,
        dst: action.dst,
        dstPort: action.dstPort
      };
      return {
        ...state,
        graph: { ...state.graph, connections: [...kept, conn] },
        revision: state.revision + 1,
        connectError: null
      };
    }

    case 'disconnect': {
      const exists = state.graph.connections.some((c) => c.id === action.connectionId);
      if (!exists) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          connections: state.graph.connections.filter((c) => c.id !== action.connectionId)
        },
        revision: state.revision + 1
      };
    }

    case 'deleteNode': {
      const exists = state.graph.nodes.some((n) => n.id === action.id);
      if (!exists) return state;
      return {
        ...state,
        graph: {
          nodes: state.graph.nodes.filter((n) => n.id !== action.id),
          connections: state.graph.connections.filter(
            (c) => c.src !== action.id && c.dst !== action.id
          )
        },
        revision: state.revision + 1,
        selectedNodeId: state.selectedNodeId === action.id ? null : state.selectedNodeId
      };
    }

    case 'setFloat': {
      const node = state.graph.nodes.find((n) => n.id === action.id);
      if (!node || node.kind !== 'constFloat') return state;
      const value = Number.isFinite(action.value) ? action.value : 0;
      if (node.value === value) return state;
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: state.graph.nodes.map((n) =>
            n.id === action.id && n.kind === 'constFloat' ? { ...n, value } : n
          )
        },
        revision: state.revision + 1
      };
    }

    case 'setVec3': {
      const node = state.graph.nodes.find((n) => n.id === action.id);
      if (!node || node.kind !== 'constVec3') return state;
      const value = action.value.map((v) => (Number.isFinite(v) ? v : 0)) as [
        number,
        number,
        number
      ];
      if (
        node.value[0] === value[0] &&
        node.value[1] === value[1] &&
        node.value[2] === value[2]
      ) {
        return state;
      }
      return {
        ...state,
        graph: {
          ...state.graph,
          nodes: state.graph.nodes.map((n) =>
            n.id === action.id && n.kind === 'constVec3' ? { ...n, value } : n
          )
        },
        revision: state.revision + 1
      };
    }

    case 'select':
      return { ...state, selectedNodeId: action.id };

    case 'clearConnectError':
      return state.connectError ? { ...state, connectError: null } : state;

    case 'replaceGraph':
      return {
        graph: action.graph,
        revision: action.revision ?? state.revision + 1,
        selectedNodeId: null,
        connectError: null
      };

    default:
      return state;
  }
}

/** 工厂：创建带初始位置的节点 */
export function makeNode(kind: NodeKind, x: number, y: number): GraphNode {
  const id = newId('n');
  const base = { id, position: { x, y } };
  switch (kind) {
    case 'constFloat':
      return { ...base, kind, value: 0.5 };
    case 'constVec3':
      return { ...base, kind, value: [0.8, 0.2, 0.6] as [number, number, number] };
    case 'uv':
      return { ...base, kind };
    case 'time':
      return { ...base, kind };
    case 'add':
      return { ...base, kind };
    case 'mul':
      return { ...base, kind };
    case 'lerp':
      return { ...base, kind };
    case 'output':
      return { ...base, kind };
  }
}

/** 初始示例：mix(vec3常量, UV, 时间*0.1) -> 颜色输出 */
export function createInitialState(): EditorState {
  const c: GraphNode = { id: 'n_color', kind: 'constVec3', position: { x: 60, y: 80 }, value: [0.9, 0.4, 0.1] };
  const uv: GraphNode = { id: 'n_uv', kind: 'uv', position: { x: 60, y: 220 } };
  const time: GraphNode = { id: 'n_time', kind: 'time', position: { x: 60, y: 340 } };
  const half: GraphNode = { id: 'n_half', kind: 'constFloat', position: { x: 60, y: 430 }, value: 0.15 };
  const mul: GraphNode = { id: 'n_mul', kind: 'mul', position: { x: 320, y: 380 } };
  const lerp: GraphNode = { id: 'n_lerp', kind: 'lerp', position: { x: 560, y: 220 } };
  const out: GraphNode = { id: 'n_out', kind: 'output', position: { x: 820, y: 220 } };

  const conn = (id: string, src: string, dst: string, dstPort: string): Connection => ({
    id,
    src,
    dst,
    dstPort
  });

  const graph: Graph = {
    nodes: [c, uv, time, half, mul, lerp, out],
    connections: [
      conn('c1', 'n_color', 'n_lerp', 'a'),
      conn('c2', 'n_uv', 'n_lerp', 'b'),
      conn('c3', 'n_time', 'n_mul', 'a'),
      conn('c4', 'n_half', 'n_mul', 'b'),
      conn('c5', 'n_mul', 'n_lerp', 't'),
      conn('c6', 'n_lerp', 'n_out', 'color')
    ]
  };
  return { graph, revision: 1, selectedNodeId: null, connectError: null };
}
