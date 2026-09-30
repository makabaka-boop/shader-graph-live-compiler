import { useRef, useState } from 'react';
import {
  Connection,
  Graph,
  GraphNode,
  INPUT_PORTS,
  NodeKind,
  outputType
} from '../graph/types';
import {
  absInputPort,
  absOutputPort,
  bezierPath,
  CANVAS_H,
  CANVAS_W,
  headerLabel,
  inputPortPos,
  nodeHeight,
  NODE_WIDTH,
  outputPortPos,
  TYPE_COLORS
} from './layout';

interface PendingWire {
  src: string;
  x: number;
  y: number;
}

interface DragState {
  id: string;
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

interface Props {
  graph: Graph;
  selectedNodeId: string | null;
  errorNodeIds: Set<string>;
  onMoveNode: (id: string, x: number, y: number) => void;
  onConnect: (src: string, dst: string, dstPort: string) => void;
  onDisconnect: (connectionId: string) => void;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
}

const NODES_WITH_INPUT_OUTPUT: NodeKind[] = ['add', 'mul', 'lerp', 'output'];

export function GraphCanvas({
  graph,
  selectedNodeId,
  errorNodeIds,
  onMoveNode,
  onConnect,
  onDisconnect,
  onSelect,
  onDelete
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [pending, setPending] = useState<PendingWire | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  function toLocal(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    // SVG 视口固定为 CANVAS_W x CANVAS_H，preserveAspectRatio="none" 拉伸
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_W,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_H
    };
  }

  function startNodeDrag(e: React.PointerEvent, node: GraphNode) {
    if (pending) return;
    e.stopPropagation();
    onSelect(node.id);
    const p = toLocal(e);
    setDrag({
      id: node.id,
      pointerId: e.pointerId,
      offsetX: p.x - node.position.x,
      offsetY: p.y - node.position.y
    });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = toLocal(e);
    if (drag) {
      const x = Math.max(0, Math.min(CANVAS_W - NODE_WIDTH, p.x - drag.offsetX));
      const y = Math.max(0, Math.min(CANVAS_H - 40, p.y - drag.offsetY));
      onMoveNode(drag.id, x, y);
    } else if (pending) {
      setPending({ ...pending, x: p.x, y: p.y });
    }
  }

  function endInteraction(e: React.PointerEvent) {
    if (drag?.pointerId === e.pointerId) setDrag(null);
  }

  function startWire(e: React.PointerEvent, node: GraphNode) {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = absOutputPort(node);
    setPending({ src: node.id, x: p.x, y: p.y });
  }

  function endWireOnPort(e: React.PointerEvent, node: GraphNode, port: string) {
    e.stopPropagation();
    if (pending) {
      onConnect(pending.src, node.id, port);
      setPending(null);
    }
  }

  function cancelWire() {
    setPending(null);
  }

  function wirePath(c: Connection): string | null {
    const src = nodeById.get(c.src);
    const dst = nodeById.get(c.dst);
    if (!src || !dst) return null;
    const portIndex = INPUT_PORTS[dst.kind].findIndex((p) => p.name === c.dstPort);
    if (portIndex < 0) return null;
    const a = absOutputPort(src);
    const b = absInputPort(dst, portIndex);
    return bezierPath(a.x, a.y, b.x, b.y);
  }

  return (
    <svg
      ref={svgRef}
      className="graph-canvas"
      viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
      preserveAspectRatio="none"
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerDown={(e) => {
        if (e.target === svgRef.current) {
          onSelect(null);
          cancelWire();
        }
      }}
    >
      {/* 连线层 */}
      <g>
        {graph.connections.map((c) => {
          const d = wirePath(c);
          if (!d) return null;
          return (
            <g key={c.id}>
              <path
                d={d}
                className="wire-hit"
                onClick={(e) => {
                  e.stopPropagation();
                  onDisconnect(c.id);
                }}
              />
              <path d={d} className="wire" pointerEvents="none" />
            </g>
          );
        })}
        {pending &&
          (() => {
            const src = nodeById.get(pending.src);
            if (!src) return null;
            const a = absOutputPort(src);
            return <path d={bezierPath(a.x, a.y, pending.x, pending.y)} className="wire-pending" />;
          })()}
      </g>

      {/* 节点层 */}
      {graph.nodes.map((node) => {
        const h = nodeHeight(node);
        const ports = INPUT_PORTS[node.kind];
        const selected = node.id === selectedNodeId;
        const hasErr = errorNodeIds.has(node.id);
        const kindOut = outputType(node.kind);
        return (
          <g
            key={node.id}
            transform={`translate(${node.position.x},${node.position.y})`}
            onPointerDown={(e) => startNodeDrag(e, node)}
            onPointerUp={cancelWire}
          >
            <rect
              className={`node-card${selected ? ' selected' : ''}${hasErr ? ' has-error' : ''}`}
              width={NODE_WIDTH}
              height={h}
            />
            <rect className="node-header" width={NODE_WIDTH} height={26} rx={8} />
            <rect y={18} width={NODE_WIDTH} height={8} className="node-header" />
            <text x={10} y={17} className="node-title">
              {headerLabel(node)}
            </text>
            <text x={NODE_WIDTH - 10} y={17} textAnchor="end" className="node-sub">
              {NODES_WITH_INPUT_OUTPUT.includes(node.kind) ? '' : kindOut === 'generic' ? '' : kindOut}
            </text>

            {/* 输入端口 */}
            {ports.map((port, i) => {
              const p = inputPortPos(node, i);
              const color =
                port.type === 'generic' ? TYPE_COLORS.generic : TYPE_COLORS[port.type];
              return (
                <g
                  key={port.name}
                  onPointerUp={(e) => endWireOnPort(e, node, port.name)}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={6}
                    className="port-circle"
                    fill={color}
                  />
                  <text x={12} y={p.y + 3} className="port-label">
                    {port.label}
                    <tspan fill={color}> :{port.type === 'generic' ? 'T' : port.type}</tspan>
                  </text>
                </g>
              );
            })}

            {/* 输出端口（输出节点没有） */}
            {node.kind !== 'output' && (
              <circle
                cx={outputPortPos(node).x}
                cy={outputPortPos(node).y}
                r={6}
                className="port-circle"
                fill={kindOut === 'generic' ? TYPE_COLORS.generic : TYPE_COLORS[kindOut]}
                onPointerDown={(e) => startWire(e, node)}
              />
            )}

            {/* 常量节点显示当前值 */}
            {node.kind === 'constFloat' && (
              <text x={10} y={h - 8} className="node-sub">
                = {Number(node.value).toFixed(3)}
              </text>
            )}
            {node.kind === 'constVec3' && (
              <text x={10} y={h - 8} className="node-sub">
                = ({node.value.map((v) => v.toFixed(2)).join(', ')})
              </text>
            )}

            {selected && node.kind !== 'output' && (
              <g
                transform={`translate(${NODE_WIDTH - 6}, ${h - 4})`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  onDelete(node.id);
                }}
                style={{ cursor: 'pointer' }}
              >
                <circle r={9} fill="#3a2030" />
                <text x={0} y={3.5} textAnchor="middle" fontSize={10} fill="#ff9a9a">
                  ×
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
