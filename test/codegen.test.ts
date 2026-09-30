import { describe, expect, it } from 'vitest';
import { buildShaders, topologicalOrder } from '../src/graph/codegen';
import { GraphNode } from '../src/graph/types';
import { c, graph, minimalValidGraph, n } from './helpers';

describe('拓扑排序', () => {
  it('输出节点在末尾，所有依赖排在前面', () => {
    const v1 = n('constVec3');
    const v2 = n('constVec3');
    const f = n('constFloat');
    const lerp = n('lerp');
    const out = n('output');
    const g = graph([out, lerp, v1, v2, f], [
      c(v1.id, lerp.id, 'a'),
      c(v2.id, lerp.id, 'b'),
      c(f.id, lerp.id, 't'),
      c(lerp.id, out.id, 'color')
    ]);
    const order = topologicalOrder(g, out.id);
    expect(order).not.toBeNull();
    expect(order![order!.length - 1]).toBe(out.id);
    expect(order!.indexOf(v1.id)).toBeLessThan(order!.indexOf(lerp.id));
    expect(order!.indexOf(v2.id)).toBeLessThan(order!.indexOf(lerp.id));
    expect(order!.indexOf(f.id)).toBeLessThan(order!.indexOf(lerp.id));
    expect(order!.indexOf(lerp.id)).toBeLessThan(order!.indexOf(out.id));
  });

  it('只包含输出可达子图，断开的节点不在序列中', () => {
    const { g, out } = minimalValidGraph();
    const orphan = n('time');
    g.nodes.push(orphan);
    const order = topologicalOrder(g, out)!;
    expect(order).not.toContain(orphan.id);
  });

  it('有环时返回 null', () => {
    const a = n('add');
    const b = n('mul');
    const f = n('constFloat');
    const out = n('output');
    const g = graph([a, b, f, out], [
      c(f.id, a.id, 'a'),
      c(b.id, a.id, 'b'), // b -> a
      c(a.id, b.id, 'a'), // a -> b（成环）
      c(f.id, b.id, 'b'),
      c(a.id, out.id, 'color') // 环连通到输出
    ]);
    expect(topologicalOrder(g, out.id)).toBeNull();
  });
});

describe('GLSL 生成', () => {
  it('合法图生成顶点/片段着色器，语句按拓扑序出现', () => {
    const v1 = n('constVec3', { id: 'k_v1' });
    const uv = n('uv', { id: 'k_uv' });
    const time = n('time', { id: 'k_time' });
    const half = n('constFloat', { id: 'k_half' });
    (half as Extract<GraphNode, { kind: 'constFloat' }>).value = 0.25;
    const mul = n('mul', { id: 'k_mul' });
    const lerp = n('lerp', { id: 'k_lerp' });
    const out = n('output', { id: 'k_out' });
    const g = graph([v1, uv, time, half, mul, lerp, out], [
      c(v1.id, lerp.id, 'a'),
      c(uv.id, lerp.id, 'b'),
      c(time.id, mul.id, 'a'),
      c(half.id, mul.id, 'b'),
      c(mul.id, lerp.id, 't'),
      c(lerp.id, out.id, 'color')
    ]);

    const built = buildShaders(g);
    expect(built.ok).toBe(true);
    expect(built.fragmentShader).toContain('#version 300 es');
    expect(built.fragmentShader).toContain('uniform float u_time;');
    expect(built.fragmentShader).toContain('fragColor');

    // 顺序：常量/UV/time < mul < lerp < output（变量名在代码生成时重映射为 n<下标>）
    const order = built.order!;
    expect(order).toEqual([
      'k_v1',
      'k_uv',
      'k_time',
      'k_half',
      'k_mul',
      'k_lerp',
      'k_out'
    ]);

    const body = built.fragmentShader!;
    const varOf = (id: string) => `n${order.indexOf(id)}`;
    expect(body.indexOf(varOf('k_mul'))).toBeGreaterThan(body.indexOf(varOf('k_time')));
    expect(body.indexOf(varOf('k_lerp'))).toBeGreaterThan(body.indexOf(varOf('k_mul')));
    expect(body.indexOf(varOf('k_out'))).toBeGreaterThan(body.indexOf(varOf('k_lerp')));
    // mul(float,float) -> float，接入 lerp.t 直接可用
    expect(body).toMatch(/float n\d+ = \(n\d+\) \* \(n\d+\);/);
    expect(body).toMatch(/vec3 n\d+ = mix\(n\d+, n\d+, n\d+\);/);
    expect(body).toContain('vec3(v_uv, 0.0)');
    // 常量 0.25 正确格式化
    expect(body).toMatch(/float n\d+ = 0\.25;/);
  });

  it('vec3 常量输出三个分量', () => {
    const v = n('constVec3', { id: 'col' });
    const out = n('output');
    const g = graph([v, out], [c(v.id, out.id, 'color')]);
    const built = buildShaders(g);
    expect(built.ok).toBe(true);
    expect(built.fragmentShader).toMatch(/vec3 n\d+ = vec3\(0\.10*?, 0\.20*?, 0\.30*?\);/);
  });

  it('float 乘到 vec3 场景：add(float,float) 输出接入 vec3 端口时生成 vec3(...) 提升', () => {
    const f1 = n('constFloat');
    const f2 = n('constFloat');
    const add = n('add');
    const lerpA = n('constVec3');
    const lerpB = n('constVec3');
    const lerp = n('lerp');
    const out = n('output');
    const g = graph([f1, f2, add, lerpA, lerpB, lerp, out], [
      c(f1.id, add.id, 'a'),
      c(f2.id, add.id, 'b'),
      c(lerpA.id, lerp.id, 'a'),
      c(lerpB.id, lerp.id, 'b'),
      c(add.id, lerp.id, 't'), // float 直接接 float 端口，不提升
      c(lerp.id, out.id, 'color')
    ]);
    const built = buildShaders(g);
    expect(built.ok).toBe(true);
    const body = built.fragmentShader!;
    // t 是 float 端口，不需要 vec3 包装
    expect(body).toMatch(/mix\(n\d+, n\d+, n\d+\)/);
  });

  it('不合法图不生成着色器，附带诊断', () => {
    const g = graph([n('output')], []);
    const built = buildShaders(g);
    expect(built.ok).toBe(false);
    expect(built.fragmentShader).toBeUndefined();
    expect(built.diagnostics.length).toBeGreaterThan(0);
  });
});
