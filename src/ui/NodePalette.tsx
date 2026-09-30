import {
  Graph,
  GraphNode,
  MAX_NODES,
  NodeKind,
  NODE_LABELS
} from '../graph/types';
import { makeNode } from '../state/editorReducer';
import { CANVAS_H, CANVAS_W, NODE_WIDTH } from './layout';

interface Props {
  graph: Graph;
  onAddNode: (node: GraphNode) => void;
}

const PALETTE: NodeKind[] = [
  'constFloat',
  'constVec3',
  'uv',
  'time',
  'add',
  'mul',
  'lerp',
  'output'
];

export function NodePalette({ graph, onAddNode }: Props) {
  const hasOutput = graph.nodes.some((n) => n.kind === 'output');
  const atLimit = graph.nodes.length >= MAX_NODES;

  function handleAdd(kind: NodeKind) {
    // 在可视区域内错开摆放，避免完全重叠
    const idx = graph.nodes.length;
    const x = Math.min(CANVAS_W - NODE_WIDTH - 20, 120 + (idx % 4) * 40);
    const y = Math.min(CANVAS_H - 120, 80 + (idx % 5) * 48);
    onAddNode(makeNode(kind, x, y));
  }

  return (
    <div className="palette">
      <h2>节点</h2>
      {PALETTE.map((kind) => {
        const disabled = atLimit || (kind === 'output' && hasOutput);
        return (
          <button
            key={kind}
            disabled={disabled}
            onClick={() => handleAdd(kind)}
            title={
              disabled
                ? '已不可添加（节点上限 50 / 输出唯一）'
                : `添加${NODE_LABELS[kind]}`
            }
          >
            + {NODE_LABELS[kind]}
          </button>
        );
      })}
      <div style={{ marginTop: 'auto', color: 'var(--text-dim)', fontSize: 11 }}>
        节点 {graph.nodes.length}/{MAX_NODES}
      </div>
    </div>
  );
}
