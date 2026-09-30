import { Graph } from '../graph/types';
import { Diagnostic, ValidationResult } from '../graph/validate';

interface Props {
  graph: Graph;
  validation: ValidationResult;
  selectedNodeId: string | null;
  onSelect: (id: string | null) => void;
}

export function DiagnosticsPanel({ graph, validation, selectedNodeId, onSelect }: Props) {
  const errors = validation.diagnostics.filter((d) => d.severity === 'error');
  const unreachableCount = graph.nodes.length - validation.reachable.size;

  return (
    <div className="panel-section">
      <h2>诊断</h2>
      <div className="diagnostics">
        {errors.length === 0 && (
          <div className="diag empty">✓ 输出可达子图类型检查通过、无环</div>
        )}
        {errors.map((d: Diagnostic, i) => (
          <div
            key={`${d.code}-${d.nodeId ?? i}`}
            className="diag"
            onClick={() => d.nodeId && onSelect(d.nodeId)}
            style={{ cursor: d.nodeId ? 'pointer' : 'default' }}
          >
            {d.message}
          </div>
        ))}
        {unreachableCount > 0 && (
          <div className="diag unreachable">
            ⓘ {unreachableCount} 个节点不在输出可达子图中，不参与编译（断开的节点不影响输出）
          </div>
        )}
        {selectedNodeId && (
          <div className="diag unreachable">已选节点 id：{selectedNodeId}</div>
        )}
      </div>
    </div>
  );
}
