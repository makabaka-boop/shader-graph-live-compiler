import { describe, expect, it } from 'vitest';
import {
  initPreviewState,
  isInSync,
  previewReducer,
  previewStatusText
} from '../src/state/previewMachine';
import { buildShaders, BuildResult } from '../src/graph/codegen';
import { c, graph, minimalValidGraph, n } from './helpers';

function okBuild(): BuildResult {
  return buildShaders(minimalValidGraph().g);
}

function syncedState() {
  const { g } = minimalValidGraph();
  let s = initPreviewState();
  s = previewReducer(s, { type: 'edit', revision: 1, graph: g });
  s = previewReducer(s, { type: 'workerResult', revision: 1, result: okBuild() });
  s = previewReducer(s, { type: 'compiled', revision: 1, graph: g });
  return { s, g };
}

describe('上下文丢失', () => {
  it('丢失后标明预览失效、抹掉可显示画面，且不能继续导出', () => {
    const { s: synced } = syncedState();
    expect(isInSync(synced)).toBe(true);

    const lost = previewReducer(synced, { type: 'contextLost' });
    expect(lost.contextLost).toBe(true);
    expect(lost.displayedRevision).toBeNull();
    expect(lost.renderedGraph).toBeNull();
    expect(isInSync(lost)).toBe(false);
    expect(previewStatusText(lost).tone).toBe('lost');
  });

  it('丢失期间到达的编译回调不能恢复画面', () => {
    const { s: synced, g } = syncedState();
    let s = previewReducer(synced, { type: 'contextLost' });
    s = previewReducer(s, { type: 'compiled', revision: 1, graph: g });
    expect(s.displayedRevision).toBeNull();
    s = previewReducer(s, { type: 'compileFailed', revision: 1, message: 'x' });
    expect(s.contextLost).toBe(true);
  });

  it('重复丢失事件幂等', () => {
    const { s: synced } = syncedState();
    const l1 = previewReducer(synced, { type: 'contextLost' });
    const l2 = previewReducer(l1, { type: 'contextLost' });
    expect(l2).toBe(l1);
  });
});

describe('上下文恢复：重建当前合法图', () => {
  it('当前修订的 Worker 产物仍在时，恢复后直接重新编译同一修订', () => {
    const { s: synced, g } = syncedState();
    let s = previewReducer(synced, { type: 'contextLost' });
    s = previewReducer(s, { type: 'contextRestored', graph: g });

    expect(s.contextLost).toBe(false);
    expect(s.compileStatus).toBe('pending');
    expect(s.compileRequest?.revision).toBe(1);
    expect(s.compileRequest).not.toBeNull();

    s = previewReducer(s, { type: 'compiled', revision: 1, graph: g });
    expect(isInSync(s)).toBe(true);
    expect(s.displayedRevision).toBe(1);
  });

  it('丢失期间有新编辑：恢复后重新走 Worker，而不是直接用旧产物', () => {
    const { s: synced } = syncedState();
    let s = previewReducer(synced, { type: 'contextLost' });

    // 丢失期间用户编辑了当前图（修订前进）
    const next = minimalValidGraph().g; // 内容可不同，修订为 2
    s = previewReducer(s, { type: 'edit', revision: 2, graph: next });
    expect(s.contextLost).toBe(true);

    const oldTick = s.buildTick;
    s = previewReducer(s, { type: 'contextRestored', graph: next });
    expect(s.contextLost).toBe(false);
    expect(s.buildTick).toBe(oldTick + 1); // 重新请求构建
    expect(s.compileRequest).toBeNull(); // 不能直接编译旧产物
    expect(s.workerStatus).toBe('pending');

    s = previewReducer(s, { type: 'workerResult', revision: 2, result: okBuild() });
    expect(s.compileRequest?.revision).toBe(2);
    s = previewReducer(s, { type: 'compiled', revision: 2, graph: next });
    expect(isInSync(s)).toBe(true);
    expect(s.displayedRevision).toBe(2);
  });

  it('恢复后不会回退显示丢失前的旧画面', () => {
    const { s: synced, g } = syncedState();
    let s = previewReducer(synced, { type: 'contextLost' });
    expect(s.displayedRevision).toBeNull();
    s = previewReducer(s, { type: 'contextRestored', graph: g });
    // 恢复后、重新编译完成前：没有画面
    expect(s.displayedRevision).toBeNull();
    expect(isInSync(s)).toBe(false);
  });
});

describe('导出一致性闸门', () => {
  it('画面修订与图修订不一致时禁止导出', () => {
    let s = initPreviewState();
    const { g } = minimalValidGraph();
    s = previewReducer(s, { type: 'edit', revision: 1, graph: g });
    expect(isInSync(s)).toBe(false); // 还在构建
    s = previewReducer(s, { type: 'workerResult', revision: 1, result: okBuild() });
    s = previewReducer(s, { type: 'compiled', revision: 1, graph: g });
    expect(isInSync(s)).toBe(true);
    s = previewReducer(s, { type: 'edit', revision: 2, graph: g });
    expect(isInSync(s)).toBe(false); // 画面停留在 #1，不能导出 #2 的图
  });
});
