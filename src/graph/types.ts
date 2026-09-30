// 颜色图核心数据模型

export type DataType = 'float' | 'vec3';

export type NodeKind =
  | 'constFloat'
  | 'constVec3'
  | 'uv'
  | 'time'
  | 'add'
  | 'mul'
  | 'lerp'
  | 'output';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 所有节点共用的判别联合。
 * id 在编辑器内由 crypto.randomUUID 生成，保持任意非空字符串即可
 * （GLSL 生成时会另行映射为 n<下标> 标识符）。
 */
export interface GraphNodeBase {
  id: string;
  kind: NodeKind;
  position: Vec2;
}

export interface ConstFloatNode extends GraphNodeBase {
  kind: 'constFloat';
  value: number;
}

export interface ConstVec3Node extends GraphNodeBase {
  kind: 'constVec3';
  value: [number, number, number];
}

export interface UvNode extends GraphNodeBase {
  kind: 'uv';
}

export interface TimeNode extends GraphNodeBase {
  kind: 'time';
}

export interface AddNode extends GraphNodeBase {
  kind: 'add';
}

export interface MulNode extends GraphNodeBase {
  kind: 'mul';
}

export interface LerpNode extends GraphNodeBase {
  kind: 'lerp';
}

export interface OutputNode extends GraphNodeBase {
  kind: 'output';
}

export type GraphNode =
  | ConstFloatNode
  | ConstVec3Node
  | UvNode
  | TimeNode
  | AddNode
  | MulNode
  | LerpNode
  | OutputNode;

/** 一条连线：src 节点输出端口 -> dst 节点的指定输入端口 */
export interface Connection {
  id: string;
  src: string;
  dst: string;
  dstPort: string;
}

export interface Graph {
  nodes: GraphNode[];
  connections: Connection[];
}

export const MAX_NODES = 50;

/** 每个节点类型的输入端口定义（输出节点的输入叫 color） */
export interface PortDef {
  name: string;
  /** 声明类型；'generic' 表示 add/mul 的多态端口 */
  type: DataType | 'generic';
  label: string;
}

export const INPUT_PORTS: Record<NodeKind, PortDef[]> = {
  constFloat: [],
  constVec3: [],
  uv: [],
  time: [],
  add: [
    { name: 'a', type: 'generic', label: 'A' },
    { name: 'b', type: 'generic', label: 'B' }
  ],
  mul: [
    { name: 'a', type: 'generic', label: 'A' },
    { name: 'b', type: 'generic', label: 'B' }
  ],
  lerp: [
    { name: 'a', type: 'vec3', label: 'A' },
    { name: 'b', type: 'vec3', label: 'B' },
    { name: 't', type: 'float', label: 'T' }
  ],
  output: [{ name: 'color', type: 'vec3', label: '颜色' }]
};

/** 各节点输出类型；add/mul 输出类型由输入推导，标记为 generic */
export function outputType(kind: NodeKind): DataType | 'generic' {
  switch (kind) {
    case 'constFloat':
    case 'time':
      return 'float';
    case 'constVec3':
    case 'uv':
    case 'lerp':
    case 'output':
      return 'vec3';
    case 'add':
    case 'mul':
      return 'generic';
  }
}

export const NODE_LABELS: Record<NodeKind, string> = {
  constFloat: '浮点常量',
  constVec3: '三分量常量',
  uv: 'UV',
  time: '时间',
  add: '加',
  mul: '乘',
  lerp: '插值',
  output: '颜色输出'
};
