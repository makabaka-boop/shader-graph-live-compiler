import { describe, expect, it } from 'vitest';
import {
  initPreviewState,
  isInSync,
  previewReducer
} from '../src/state/previewMachine';
import { buildShaders, BuildResult } from '../src/graph/codegen';
import { c, graph, minimalValidGraph, n } from './helpers';

function okBuild(rev: number): BuildResult {
  const { g } = minimalValidGraph();
  const b = buildShaders(g);
  return { ...b, revision: rev };
}

function failBuild(rev: number): BuildResult {
  const g = graph([n('output')], []);
  return buildShaders(g);
}

function validGraphAt(_rev: number) {
  return minimalValidGraph().g;
}

describe('迟到的 Worker 结果', () => {
  it('旧修订的 workerResult 被丢弃，不触发编译', () => {
    let s = initPreviewState();
    s = previewReducer(s, { type: 'edit', revision: 1, graph: validGraphAt(1) });
    s = previewReducer(s, { type: 'edit', revision: 2, graph: validGraphAt(2) });
    expect(s.graphRevision).toBe(2);
    expect(s.buildTick).toBe(2);

    // rev=1 的结果迟到
    const before = s;
    s = previewReducer(s, { type: 'workerResult', revision: 1, result: okBuild(1) });
    expect(s).toBe(before); // 引用不变 = 完全忽略
    expect(s.compileRequest).toBeNull();
    expect(s.workerStatus).toBe('pending');

    // rev=2 的结果到达 -> 发起编译
    s = previewReducer(s, { type: 'workerResult', revision: 2, result: okBuild(2) });
    expect(s.workerStatus).toBe('ready');
    expect(s.compileRequest?.revision).toBe(2);
  });

  it('旧修订的 workerError 也不能污染新修订', () => {
    let s = initPreviewState();
    s = previewReducer(s, { type: 'edit', revision: 1, graph: validGraphAt(1) });
    s = previewReducer(s, { type: 'edit', revision: 2, graph: validGraphAt(2) });
    s = previewReducer(s, { type: 'workerError', revision: 1, message: 'boom' });
    expect(s.workerStatus).toBe('pending');
    expect(s.workerError).toBeNull();
  });

  it('连续编辑期间中间修订全部被跳过，最终修订正常完成', () => {
    let s = initPreviewState();
    for (let r = 1; r <= 5; r++) {
      s = previewReducer(s, { type: 'edit', revision: r, graph: validGraphAt(r) });
    }
    // rev=3 与 rev=4 的迟到结果
    s = previewReducer(s, { type: 'workerResult', revision: 3, result: okBuild(3) });
    s = previewReducer(s, { type: 'workerResult', revision: 4, result: failBuild(4) });
    expect(s.workerStatus).toBe('pending');
    expect(s.compileStatus).toBe('pending');

    s = previewReducer(s, { type: 'workerResult', revision: 5, result: okBuild(5) });
    expect(s.compileRequest?.revision).toBe(5);
    s = previewReducer(s, { type: 'compiled', revision: 5, graph: validGraphAt(5) });
    expect(isInSync(s)).toBe(true);
  });
});

describe('迟到的编译结果', () => {
  it('编译完成前发生了新编辑：旧 compiled 回调被丢弃', () => {
    let s = initPreviewState();
    s = previewReducer(s, { type: 'edit', revision: 1, graph: validGraphAt(1) });
    s = previewReducer(s, { type: 'workerResult', revision: 1, result: okBuild(1) });
    const req1 = s.compileRequest!;

    // 用户再次编辑
    s = previewReducer(s, { type: 'edit', revision: 2, graph: validGraphAt(2) });
    expect(s.compileRequest).toBeNull(); // 旧的待编译请求作废

    // 旧编译回调迟到
    s = previewReducer(s, { type: 'compiled', revision: 1, graph: validGraphAt(1) });
    expect(s.displayedRevision).toBeNull();
    expect(s.renderedGraph).toBeNull();
    expect(isInSync(s)).toBe(false);

    // 新修订完成 -> 正常显示
    s = previewReducer(s, { type: 'workerResult', revision: 2, result: okBuild(2) });
    expect(s.compileRequest?.nonce).toBe(req1.nonce + 1);
    s = previewReducer(s, { type: 'compiled', revision: 2, graph: validGraphAt(2) });
    expect(s.displayedRevision).toBe(2);
    expect(isInSync(s)).toBe(true);
  });

  it('旧修订的 compileFailed 不能把新修订标成错误', () => {
    let s = initPreviewState();
    s = previewReducer(s, { type: 'edit', revision: 1, graph: validGraphAt(1) });
    s = previewReducer(s, { type: 'workerResult', revision: 1, result: okBuild(1) });
    s = previewReducer(s, { type: 'edit', revision: 2, graph: validGraphAt(2) });
    s = previewReducer(s, { type: 'compileFailed', revision: 1, message: 'syntax error' });
    expect(s.compileStatus).toBe('pending');
    expect(s.compileError).toBeNull();
  });

  it('图非法时不发编译请求；修正后下一个修订恢复', () => {
    let s = initPreviewState();
    s = previewReducer(s, { type: 'edit', revision: 1, graph: validGraphAt(1) });
    const bad = graph([n('output')], []);
    s = previewReducer(s, { type: 'edit', revision: 2, graph: bad });
    s = previewReducer(s, { type: 'workerResult', revision: 2, result: failBuild(2) });
    expect(s.compileStatus).toBe('error');
    expect(s.compileRequest).toBeNull();

    s = previewReducer(s, { type: 'edit', revision: 3, graph: validGraphAt(3) });
    s = previewReducer(s, { type: 'workerResult', revision: 3, result: okBuild(3) });
    expect(s.compileStatus).toBe('pending');
    expect(s.compileRequest?.revision).toBe(3);
    s = previewReducer(s, { type: 'compiled', revision: 3, graph: validGraphAt(3) });
    expect(isInSync(s)).toBe(true);
  });
});
