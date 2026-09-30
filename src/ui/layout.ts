// 节点卡片与端口的几何布局（画布为固定 1000x620 世界坐标，不做平移缩放）
import { GraphNode, INPUT_PORTS, NODE_LABELS } from '../graph/types';

export const NODE_WIDTH = 168;
export const HEADER_HEIGHT = 30;
export const ROW_HEIGHT = 24;
export const PADDING = 8;
export const PORT_RADIUS = 6;
export const OUTPUT_ROW_OFFSET = 8;

export function nodeHeight(node: GraphNode): number {
  const rows = INPUT_PORTS[node.kind].length;
  const body = Math.max(rows, 1) * ROW_HEIGHT + PADDING * 2;
  return HEADER_HEIGHT + body;
}

/** 输入端口中心（相对节点左上角） */
export function inputPortPos(node: GraphNode, index: number): { x: number; y: number } {
  return {
    x: 0,
    y: HEADER_HEIGHT + PADDING + index * ROW_HEIGHT + ROW_HEIGHT / 2
  };
}

/** 输出端口中心（相对节点左上角）；输出节点没有输出端口 */
export function outputPortPos(node: GraphNode): { x: number; y: number } {
  const rows = INPUT_PORTS[node.kind].length;
  return {
    x: NODE_WIDTH,
    y: HEADER_HEIGHT + (rows === 0 ? PADDING + ROW_HEIGHT / 2 : OUTPUT_ROW_OFFSET + 12)
  };
}

/** 绝对坐标的输入端口 */
export function absInputPort(node: GraphNode, index: number) {
  const p = inputPortPos(node, index);
  return { x: node.position.x + p.x, y: node.position.y + p.y };
}

/** 绝对坐标的输出端口 */
export function absOutputPort(node: GraphNode) {
  const p = outputPortPos(node);
  return { x: node.position.x + p.x, y: node.position.y + p.y };
}

export const TYPE_COLORS: Record<string, string> = {
  float: '#4fc3f7',
  vec3: '#ffb74d',
  generic: '#ce93d8'
};

export function headerLabel(node: GraphNode): string {
  return NODE_LABELS[node.kind];
}

export const CANVAS_W = 1000;
export const CANVAS_H = 620;

/** 贝塞尔连接路径 */
export function bezierPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
