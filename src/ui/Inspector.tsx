import { GraphNode, NODE_LABELS } from '../graph/types';

interface Props {
  node: GraphNode | null;
  onSetFloat: (id: string, value: number) => void;
  onSetVec3: (id: string, value: [number, number, number]) => void;
  onDelete: (id: string) => void;
}

function toHex(v: [number, number, number]): string {
  const c = (x: number) =>
    Math.max(0, Math.min(255, Math.round(x * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(v[0])}${c(v[1])}${c(v[2])}`;
}

function fromHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function Inspector({ node, onSetFloat, onSetVec3, onDelete }: Props) {
  if (!node) {
    return (
      <div className="panel-section inspector">
        <h2>属性</h2>
        <p className="muted">未选中节点。在画布中点击节点进行编辑，从节点右侧圆点拖出连线。</p>
      </div>
    );
  }

  return (
    <div className="panel-section inspector">
      <h2>属性 · {NODE_LABELS[node.kind]}</h2>

      {node.kind === 'constFloat' && (
        <div className="row">
          <label>值</label>
          <input
            type="number"
            step={0.05}
            value={node.value}
            onChange={(e) => onSetFloat(node.id, parseFloat(e.target.value))}
          />
        </div>
      )}

      {node.kind === 'constVec3' && (
        <>
          <div className="row">
            <label>颜色</label>
            <input
              type="color"
              value={toHex(node.value)}
              onChange={(e) => onSetVec3(node.id, fromHex(e.target.value))}
            />
            <span className="muted">{toHex(node.value)}</span>
          </div>
          {(['R', 'G', 'B'] as const).map((ch, i) => (
            <div className="row" key={ch}>
              <label>{ch}</label>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={node.value[i]}
                onChange={(e) => {
                  const next: [number, number, number] = [...node.value];
                  next[i] = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                  onSetVec3(node.id, next);
                }}
              />
            </div>
          ))}
        </>
      )}

      {(node.kind === 'uv' || node.kind === 'time') && (
        <p className="muted">{node.kind === 'uv' ? '输出 vec3(uv.x, uv.y, 0)' : '输出秒数（float），随时间变化'}</p>
      )}

      {node.kind === 'output' && (
        <p className="muted">最终颜色（vec3，0..1 会被截断）。全图只能有一个输出节点。</p>
      )}

      <div className="row">
        <button onClick={() => onDelete(node.id)} disabled={node.kind === 'output'}>
          删除节点
        </button>
        <span className="muted" style={{ fontSize: 11 }}>
          也可在画布上点节点右下角 ×
        </span>
      </div>
    </div>
  );
}
