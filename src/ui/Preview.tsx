import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState
} from 'react';
import { GLRenderer } from '../webgl/GLRenderer';
import { isInSync, PreviewState } from '../state/previewMachine';

export interface PreviewHandle {
  captureNow: () => string | null;
}

interface Props {
  preview: PreviewState;
  onCompiled: (revision: number) => void;
  onCompileFailed: (revision: number, message: string) => void;
  onContextLost: () => void;
  onContextRestored: () => void;
}

const SIZE = 320;

export const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { preview, onCompiled, onCompileFailed, onContextLost, onContextRestored },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GLRenderer | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  // 让异步编译完成时读到最新的状态（判定迟到结果）
  const stateRef = useRef(preview);
  stateRef.current = preview;

  // 创建渲染器（仅一次；上下文事件交给 GLRenderer 回调）
  useEffect(() => {
    let renderer: GLRenderer;
    try {
      renderer = new GLRenderer(canvasRef.current!, {
        onLost,
        onRestored
      });
      rendererRef.current = renderer;
    } catch (err) {
      setFatal(err instanceof Error ? err.message : String(err));
    }
    return () => {
      renderer?.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onLost() {
    onContextLost();
  }
  function onRestored() {
    onContextRestored();
  }

  // 编译请求到达时编译；nonce 标识最新请求
  const req = preview.compileRequest;
  useEffect(() => {
    if (!req || preview.contextLost) return;
    let cancelled = false;
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.compile(req.vertexShader, req.fragmentShader).then((outcome) => {
      if (cancelled) return;
      // 迟到结果双重守卫：nonce 已变 / 修订已变 / 上下文丢失
      const cur = stateRef.current;
      if (
        !cur.compileRequest ||
        cur.compileRequest.nonce !== req.nonce ||
        cur.graphRevision !== req.revision
      ) {
        return;
      }
      if (outcome.lost) return; // 丢失事件会单独处理
      if (outcome.ok) onCompiled(req.revision);
      else onCompileFailed(req.revision, outcome.message ?? '编译失败');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.nonce, preview.contextLost]);

  // 渲染循环：只有已就绪且未丢失时按当前程序绘制
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = () => {
      const renderer = rendererRef.current;
      if (renderer && !renderer.isLost) {
        const inSync = isInSync(stateRef.current);
        // 即便在“更新中”也用上一个就绪程序继续画（动画），
        // 但上下文丢失时 displayedRevision 已被置空。
        if (stateRef.current.displayedRevision !== null) {
          renderer.draw((performance.now() - start) / 1000);
        }
        void inSync;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useImperativeHandle(ref, () => ({
    captureNow: () => {
      const renderer = rendererRef.current;
      const cur = stateRef.current;
      if (!renderer || !isInSync(cur)) return null;
      // 在当前缓冲上立即重绘一帧再抓帧，保证截图就是当前修订画面
      return renderer.capture(performance.now() / 1000);
    }
  }));

  const lost = preview.contextLost;
  const errored = !lost && (preview.compileStatus === 'error' || preview.workerStatus === 'error');

  return (
    <div className="panel-section">
      <h2>预览</h2>
      <div className="preview-box">
        <canvas
          ref={canvasRef}
          className="preview-canvas"
          width={SIZE}
          height={SIZE}
        />
        {(lost || errored || fatal) && (
          <div className="preview-overlay">
            {fatal
              ? `无法创建 WebGL2 上下文：${fatal}`
              : lost
                ? '预览失效：WebGL 上下文已丢失，恢复后将重建当前图'
                : preview.compileError ?? '当前图无法编译'}
          </div>
        )}
      </div>
    </div>
  );
});
