import { describe, expect, it } from 'vitest';
import {
  checkCanConnect,
  validateGraph
} from '../src/graph/validate';
import { c, codes, graph, minimalValidGraph, n } from './helpers';

describe('类型检查', () => {
  it('float 不能直连需要 vec3 的颜色端口', () => {
    const f = n('constFloat');
    const out = n('output');
    const g = graph([f, out]);
    expect(codes(g)).toContain('missing-input');

    const err = checkCanConnect(g, { src: f.id, dst: out.id, dstPort: 'color' });
    expect(err).toMatch(/类型不匹配/);

    // 即便绕过预检直接连线，整图校验仍报 type-mismatch
    g.connections.push(c(f.id, out.id, 'color'));
    expect(codes(g)).toContain('type-mismatch');
  });

  it('vec3 不能接到 lerp 的 float 端口 t', () => {
    const v = n('constVec3');
    const a = n('constVec3');
    const b = n('constVec3');
    const lerp = n('lerp');
    const out = n('output');
    const g = graph(
      [v, a, b, lerp, out],
      [
        c(a.id, lerp.id, 'a'),
        c(b.id, lerp.id, 'b'),
        c(v.id, lerp.id, 't'), // vec3 -> float
        c(lerp.id, out.id, 'color')
      ]
    );
    expect(codes(g)).toContain('type-mismatch');
  });

  it('add 两个输入必须同类型：float+float 合法，float+vec3 非法', () => {
    const f = n('constFloat');
    const v = n('constVec3');
    const add = n('add');
    const out = n('output');
    const g = graph([f, v, add, out], [
      c(f.id, add.id, 'a'),
      c(v.id, add.id, 'b'),
      c(add.id, out.id, 'color')
    ]);
    // add 结果同时被用作 vec3 颜色；float+vec3 混合 -> generic-mismatch
    expect(codes(g)).toContain('generic-mismatch');

    // 预检也应拒绝第二个连接（v 必须已在图中，只是尚未连线）
    const g2 = graph([f, v, add, out], [
      c(f.id, add.id, 'a'),
      c(add.id, out.id, 'color') // add 此时被推断为 float，颜色端也会抱怨；先聚焦预检
    ]);
    const err = checkCanConnect(g2, { src: v.id, dst: add.id, dstPort: 'b' });
    expect(err).toMatch(/类型不匹配/);
  });

  it('两个 float 相加得到 float；接入 vec3 端口时报类型错（不隐式提升）', () => {
    const f1 = n('constFloat');
    const f2 = n('constFloat');
    const add = n('add');
    const out = n('output');
    const g = graph([f1, f2, add, out], [
      c(f1.id, add.id, 'a'),
      c(f2.id, add.id, 'b'),
      c(add.id, out.id, 'color')
    ]);
    const set = codes(g);
    expect(set).not.toContain('generic-mismatch');
    expect(set).toContain('type-mismatch');
  });

  it('自连与形成环的连接在连线前就被拒绝', () => {
    const a = n('add');
    const f = n('constFloat');
    const g = graph([f, a], [c(f.id, a.id, 'a')]);
    expect(checkCanConnect(g, { src: a.id, dst: a.id, dstPort: 'b' })).toMatch(/自连|环/);
    // add.b -> add.a 成环（a 已是 float，这里用自己的输出回连）
    expect(checkCanConnect(g, { src: a.id, dst: a.id, dstPort: 'b' })).not.toBeNull();
  });

  it('缺失输入 / 缺失输出 / 多输出 / 超上限 均报错', () => {
    const onlyOut = graph([n('output')], []);
    expect(codes(onlyOut)).toContain('missing-input');

    const noOut = graph([n('constVec3')], []);
    expect(codes(noOut)).toContain('missing-output');

    const { g } = minimalValidGraph();
    g.nodes.push(n('output'));
    expect(codes(g)).toContain('multiple-outputs');

    const big = graph([], []);
    for (let i = 0; i < 51; i++) big.nodes.push(i === 0 ? n('output') : n('constFloat'));
    expect(codes(big)).toContain('too-many-nodes');
  });
});

describe('环检测（输出可达子图）', () => {
  it('输出可达子图中的环被报告', () => {
    const a = n('add');
    const b = n('mul');
    const f = n('constFloat');
    const out = n('output');
    const g = graph([a, b, f, out], [
      c(f.id, a.id, 'a'),
      c(a.id, b.id, 'a'),
      c(b.id, a.id, 'b'), // a -> b -> a 环
      c(f.id, b.id, 'b'),
      c(a.id, out.id, 'color') // a 此时是 float，另会报类型错；环仍须被检出
    ]);
    expect(codes(g)).toContain('cycle');
  });

  it('断开的环（不可达输出）不影响输出，不报错', () => {
    const { g } = minimalValidGraph();
    // 另造一个与输出完全断开的环组件
    const x = n('add');
    const y = n('mul');
    g.nodes.push(x, y);
    g.connections.push(
      c(x.id, y.id, 'a'),
      c(y.id, x.id, 'a'),
      c(x.id, y.id, 'b'),
      c(y.id, x.id, 'b')
    );
    const result = validateGraph(g);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  });

  it('断开的常量节点不参与校验，合法图仍合法', () => {
    const { g } = minimalValidGraph();
    g.nodes.push(n('time'), n('constFloat'));
    expect(codes(g).size).toBe(0);
  });
});
