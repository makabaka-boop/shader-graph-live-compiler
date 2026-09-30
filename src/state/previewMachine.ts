// 预览管线状态机（纯函数，便于单测）。
//
// 两条异步通道都用修订号守卫：
//   编辑 -> Worker 排序/生成 -> 主线程编译 GLSL -> 显示
// 任何迟到（revision < 当前 graphRevision）的 Worker 结果或编译结果一律丢弃，
// 绝不允许旧修订覆盖新修订。
//
// 上下文丢失：contextLost=true，显示标记为失效，停止绘制；
// 恢复后：依据当前修订重新构建/编译（重建当前合法图），不会回退到旧画面。
import { Graph } from '../graph/types';
import { BuildResult } from '../graph/codegen';

export type AsyncStatus = 'idle' | 'pending' | 'ready' | 'error';

export interface CompileRequest {
  revision: number;
  vertexShader: string;
  fragmentShader: string;
  /** 每次重新编译请求递增；React 层用它识别最新请求 */
  nonce: number;
}

export interface PreviewState {
  /** 最新编辑修订 */
  graphRevision: number;
  /** 当前图快照（仅用于上下文恢复时重建） */
  graph: Graph | null;

  // ---- Worker 阶段 ----
  workerStatus: AsyncStatus;
  workerRevision: number;
  buildTick: number; // 需要向 Worker 发起构建的信号（递增触发副作用）
  lastBuild: { revision: number; result: BuildResult } | null;
  workerError: string | null;

  // ---- 编译阶段 ----
  compileStatus: AsyncStatus;
  compileRevision: number;
  compileRequest: CompileRequest | null;
  compileError: string | null;
  /** 单调递增的编译请求计数，永不因编辑归零（用于识别迟到编译） */
  compileNonce: number;

  // ---- 显示阶段 ----
  /** 当前画面所用程序对应的修订；null 表示没有可显示画面 */
  displayedRevision: number | null;
  /** 当前画面所用程序编译自的图快照（导出以此为准，保证图与截图同一修订） */
  renderedGraph: Graph | null;

  contextLost: boolean;
}

export type PreviewEvent =
  | { type: 'edit'; revision: number; graph: Graph }
  | { type: 'workerResult'; revision: number; result: BuildResult }
  | { type: 'workerError'; revision: number; message: string }
  | { type: 'compiled'; revision: number; graph: Graph }
  | { type: 'compileFailed'; revision: number; message: string }
  | { type: 'contextLost' }
  | { type: 'contextRestored'; graph: Graph };

export function initPreviewState(): PreviewState {
  return {
    graphRevision: 0,
    graph: null,
    workerStatus: 'idle',
    workerRevision: 0,
    buildTick: 0,
    lastBuild: null,
    workerError: null,
    compileStatus: 'idle',
    compileRevision: 0,
    compileRequest: null,
    compileError: null,
    compileNonce: 0,
    displayedRevision: null,
    renderedGraph: null,
    contextLost: false
  };
}

export function previewReducer(state: PreviewState, event: PreviewEvent): PreviewState {
  switch (event.type) {
    case 'edit': {
      if (event.revision <= state.graphRevision) return state; // 乱序/重复编辑
      return {
        ...state,
        graph: event.graph,
        graphRevision: event.revision,
        workerStatus: 'pending',
        buildTick: state.buildTick + 1,
        workerError: null,
        // 新编辑使所有旧的编译结果与待编译请求失效（但不抹掉旧画面，
        // 旧画面在新程序就绪前继续显示，只是“过期”）
        compileStatus: 'pending',
        compileRequest: null,
        compileError: null
      };
    }

    case 'workerResult': {
      // 迟到的 Worker 结果不能覆盖新修订
      if (event.revision !== state.graphRevision) return state;
      if (state.contextLost) {
        // 上下文丢失期间到达的结果：记下但不发起编译，等恢复后重建
        return {
          ...state,
          workerStatus: event.result.ok ? 'ready' : 'error',
          workerRevision: event.revision,
          lastBuild: { revision: event.revision, result: event.result },
          workerError: event.result.ok ? null : firstError(event.result)
        };
      }
      if (!event.result.ok || !event.result.vertexShader || !event.result.fragmentShader) {
        return {
          ...state,
          workerStatus: 'error',
          workerRevision: event.revision,
          lastBuild: { revision: event.revision, result: event.result },
          workerError: firstError(event.result),
          compileStatus: 'error',
          compileRevision: event.revision,
          compileError: firstError(event.result),
          compileNonce: state.compileNonce
        };
      }
      return {
        ...state,
        workerStatus: 'ready',
        workerRevision: event.revision,
        lastBuild: { revision: event.revision, result: event.result },
        workerError: null,
        compileStatus: 'pending',
        compileRevision: event.revision,
        compileNonce: state.compileNonce + 1,
        compileRequest: {
          revision: event.revision,
          vertexShader: event.result.vertexShader,
          fragmentShader: event.result.fragmentShader,
          nonce: state.compileNonce + 1
        },
        compileError: null
      };
    }

    case 'workerError': {
      if (event.revision !== state.graphRevision) return state;
      return {
        ...state,
        workerStatus: 'error',
        workerRevision: event.revision,
        workerError: event.message,
        compileStatus: 'error',
        compileRevision: event.revision,
        compileError: event.message
      };
    }

    case 'compiled': {
      // 迟到的编译结果不能覆盖新修订
      if (event.revision !== state.graphRevision) return state;
      if (state.contextLost) return state; // 丢失期间的迟到回调一律忽略
      return {
        ...state,
        compileStatus: 'ready',
        compileRevision: event.revision,
        compileError: null,
        displayedRevision: event.revision,
        renderedGraph: event.graph
      };
    }

    case 'compileFailed': {
      if (event.revision !== state.graphRevision) return state;
      if (state.contextLost) return state;
      return {
        ...state,
        compileStatus: 'error',
        compileRevision: event.revision,
        compileError: event.message
      };
    }

    case 'contextLost': {
      if (state.contextLost) return state;
      return {
        ...state,
        contextLost: true,
        // 画面立即失效；旧程序资源已不可用
        displayedRevision: null,
        renderedGraph: null,
        compileRequest: null,
        compileStatus: 'idle',
        compileError: null
      };
    }

    case 'contextRestored': {
      if (!state.contextLost) return state;
      const base: PreviewState = {
        ...state,
        contextLost: false,
        compileError: null
      };
      // 重建当前（合法）图：
      // 若缓存的 Worker 产物正是当前修订，直接重新编译；否则重新走 Worker。
      const fresh =
        state.lastBuild &&
        state.lastBuild.revision === state.graphRevision &&
        state.lastBuild.result.ok;
      if (fresh && state.lastBuild!.result.vertexShader) {
        return {
          ...base,
          workerStatus: 'ready',
          compileStatus: 'pending',
          compileRevision: state.graphRevision,
          compileNonce: state.compileNonce + 1,
          compileRequest: {
            revision: state.graphRevision,
            vertexShader: state.lastBuild!.result.vertexShader!,
            fragmentShader: state.lastBuild!.result.fragmentShader!,
            nonce: state.compileNonce + 1
          }
        };
      }
      return {
        ...base,
        graph: event.graph,
        workerStatus: 'pending',
        buildTick: state.buildTick + 1,
        lastBuild: null,
        compileStatus: 'idle'
      };
    }

    default:
      return state;
  }
}

function firstError(result: BuildResult): string {
  const err = result.diagnostics.find((d) => d.severity === 'error');
  return err ? err.message : '图不合法';
}

/** 预览是否与当前修订同步（导出闸门：截图与图数据必须同修订） */
export function isInSync(state: PreviewState): boolean {
  return (
    !state.contextLost &&
    state.compileStatus === 'ready' &&
    state.displayedRevision === state.graphRevision &&
    state.renderedGraph !== null
  );
}

/** 顶部状态栏文案 */
export function previewStatusText(state: PreviewState): { text: string; tone: 'ok' | 'busy' | 'error' | 'stale' | 'lost' } {
  if (state.contextLost) return { text: 'WebGL 上下文丢失，预览失效', tone: 'lost' };
  if (state.compileStatus === 'error' || state.workerStatus === 'error') {
    return { text: state.compileError ?? '图有错误', tone: 'error' };
  }
  if (state.displayedRevision === state.graphRevision && state.compileStatus === 'ready') {
    return { text: `预览已是最新（修订 #${state.graphRevision}）`, tone: 'ok' };
  }
  if (state.workerStatus === 'pending' || state.compileStatus === 'pending') {
    return {
      text:
        state.displayedRevision !== null
          ? `更新中…（画面暂为旧修订 #${state.displayedRevision}）`
          : '构建中…',
      tone: state.displayedRevision !== null ? 'stale' : 'busy'
    };
  }
  return { text: '等待编辑', tone: 'busy' };
}
