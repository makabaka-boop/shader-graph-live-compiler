import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import './styles.css';
import { GraphCanvas } from './GraphCanvas';
import { NodePalette } from './NodePalette';
import { Inspector } from './Inspector';
import { DiagnosticsPanel } from './DiagnosticsPanel';
import { Preview, PreviewHandle } from './Preview';
import { createInitialState, editorReducer, EditorAction } from '../state/editorReducer';
import {
  initPreviewState,
  isInSync,
  previewReducer,
  previewStatusText
} from '../state/previewMachine';
import { BuildResponse } from '../graph/codegen';
import { validateGraph } from '../graph/validate';
import { Graph, GraphNode } from '../graph/types';

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导出包：图数据与截图必须指向同一修订 */
export interface ExportBundle {
  revision: number;
  exportedAt: string;
  graph: Graph;
  screenshot: string; // PNG dataURL
}

export default function App() {
  const [editor, dispatchEditor] = useReducer(editorReducer, undefined, createInitialState);
  const [preview, dispatchPreview] = useReducer(previewReducer, undefined, initPreviewState);
  const previewRef = useRef<PreviewHandle>(null);
  const workerRef = useRef<Worker | null>(null);
  const previewGraphRef = useRef<Graph>(editor.graph);

  // ---- Worker 生命周期 ----
  useEffect(() => {
    const worker = new Worker(new URL('../workers/buildWorker.ts', import.meta.url), {
      type: 'module'
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<BuildResponse>) => {
      const msg = e.data;
      // 修订号守卫在 previewReducer 内部：不匹配的结果原样丢弃
      if (msg.type === 'buildResult') {
        dispatchPreview({
          type: 'workerResult',
          revision: msg.revision,
          result: msg.result
        });
      } else {
        dispatchPreview({
          type: 'workerError',
          revision: msg.revision,
          message: msg.message
        });
      }
    };
    return () => worker.terminate();
  }, []);

  // 编辑修订变化时：更新预览机并提交一次构建（初始挂载即 revision=1）
  useEffect(() => {
    previewGraphRef.current = editor.graph;
    dispatchPreview({ type: 'edit', revision: editor.revision, graph: editor.graph });
  }, [editor.graph, editor.revision]);

  // 预览机要求构建时，向 worker 发送当前修订；迟到结果由修订号守卫丢弃
  useEffect(() => {
    if (preview.buildTick === 0) return;
    workerRef.current?.postMessage({
      type: 'build',
      revision: preview.graphRevision,
      graph: preview.graph
    });
  }, [preview.buildTick, preview.graphRevision, preview.graph]);

  const validation = useMemo(() => validateGraph(editor.graph), [editor.graph]);
  const errorNodeIds = useMemo(() => {
    const s = new Set<string>();
    for (const d of validation.diagnostics) {
      if (d.severity === 'error' && d.nodeId) s.add(d.nodeId);
    }
    return s;
  }, [validation.diagnostics]);

  const handleContextRestored = useCallback(() => {
    // 恢复后重建当前（合法）图，而不是恢复旧画面
    dispatchPreview({ type: 'contextRestored', graph: previewGraphRef.current });
  }, []);

  // ---- 导出：图数据与截图严格同一修订，且必须已同步 ----
  const exportBundle = useCallback(() => {
    if (!isInSync(preview)) {
      alert('预览尚未与当前修订同步（或上下文已丢失），无法导出一致的图与截图。');
      return;
    }
    const dataUrl = previewRef.current?.captureNow();
    if (!dataUrl) {
      alert('截图失败，请稍后重试。');
      return;
    }
    // 同一次操作中冻结同一修订的图快照
    const bundle: ExportBundle = {
      revision: preview.graphRevision,
      exportedAt: new Date().toISOString(),
      graph: preview.renderedGraph as Graph,
      screenshot: dataUrl
    };
    const rev = preview.graphRevision;
    download(`color-graph-r${rev}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    fetch(dataUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `color-graph-r${rev}.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }, [preview]);

  const exportJsonOnly = useCallback(() => {
    if (!isInSync(preview)) {
      alert('预览尚未同步，无法导出。');
      return;
    }
    const payload = {
      revision: preview.graphRevision,
      exportedAt: new Date().toISOString(),
      graph: preview.renderedGraph
    };
    download(
      `color-graph-r${preview.graphRevision}.json`,
      JSON.stringify(payload, null, 2),
      'application/json'
    );
  }, [preview]);

  const importGraph = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          const parsed = JSON.parse(text) as unknown;
          const maybeGraph =
            typeof parsed === 'object' && parsed !== null && 'graph' in parsed
              ? (parsed as { graph: unknown }).graph
              : parsed;
          const g = maybeGraph as Graph;
          if (!g || !Array.isArray(g.nodes) || !Array.isArray(g.connections)) {
            throw new Error('文件中没有合法的 graph 字段');
          }
          dispatchEditor({ type: 'replaceGraph', graph: g });
        } catch (err) {
          alert(`导入失败：${err instanceof Error ? err.message : String(err)}`);
        }
      });
    };
    input.click();
  }, []);

  // Delete 键删除选中节点
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && editor.selectedNodeId) {
        const node = editor.graph.nodes.find((n) => n.id === editor.selectedNodeId);
        if (node && node.kind !== 'output') {
          dispatchEditor({ type: 'deleteNode', id: editor.selectedNodeId });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor.selectedNodeId, editor.graph.nodes]);

  const dispatch = (a: EditorAction) => dispatchEditor(a);
  const status = previewStatusText(preview);

  return (
    <div className="app">
      <div className="toolbar">
        <h1>颜色图编辑器</h1>
        <span className="revision-badge">图修订 #{editor.revision}</span>
        <span className={`status-pill ${status.tone}`}>{status.text}</span>
        <span className="spacer" />
        <button onClick={importGraph}>导入 JSON</button>
        <button onClick={exportJsonOnly} disabled={!isInSync(preview)}>
          导出图数据
        </button>
        <button className="primary" onClick={exportBundle} disabled={!isInSync(preview)}>
          导出图 + 截图（同一修订）
        </button>
      </div>

      <div className="main">
        <NodePalette graph={editor.graph} onAddNode={(node: GraphNode) => dispatch({ type: 'addNode', node })} />

        <div className="canvas-wrap">
          <GraphCanvas
            graph={editor.graph}
            selectedNodeId={editor.selectedNodeId}
            errorNodeIds={errorNodeIds}
            onMoveNode={(id, x, y) => dispatch({ type: 'moveNode', id, x, y })}
            onConnect={(src, dstNode, dstPort) =>
              dispatch({ type: 'connect', src, dst: dstNode, dstPort })
            }
            onDisconnect={(connectionId) => dispatch({ type: 'disconnect', connectionId })}
            onSelect={(id) => dispatch({ type: 'select', id })}
            onDelete={(id) => dispatch({ type: 'deleteNode', id })}
          />
          {editor.connectError && <div className="toast">连接被拒绝：{editor.connectError}</div>}
        </div>

        <div className="side">
          <Preview
            ref={previewRef}
            preview={preview}
            onCompiled={(revision) =>
              dispatchPreview({ type: 'compiled', revision, graph: previewGraphRef.current })
            }
            onCompileFailed={(revision, message) =>
              dispatchPreview({ type: 'compileFailed', revision, message })
            }
            onContextLost={() => dispatchPreview({ type: 'contextLost' })}
            onContextRestored={handleContextRestored}
          />
          <DiagnosticsPanel
            graph={editor.graph}
            validation={validation}
            selectedNodeId={editor.selectedNodeId}
            onSelect={(id) => dispatch({ type: 'select', id })}
          />
          <Inspector
            node={
              editor.graph.nodes.find((n) => n.id === editor.selectedNodeId) ?? null
            }
            onSetFloat={(id, value) => dispatch({ type: 'setFloat', id, value })}
            onSetVec3={(id, value) => dispatch({ type: 'setVec3', id, value })}
            onDelete={(id) => dispatch({ type: 'deleteNode', id })}
          />
        </div>
      </div>
    </div>
  );
}
