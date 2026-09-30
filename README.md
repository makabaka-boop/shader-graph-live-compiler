# 颜色图编辑器（React + TypeScript + WebGL2）

在浏览器中编辑不超过 50 个节点的颜色图，实时预览。

## 运行

```bash
npm install
npm run dev        # 开发
npm test           # 29 个单测（类型/环、生成顺序、迟到结果、上下文恢复）
npm run build      # 类型检查 + 生产构建
```

## 节点

| 节点 | 输入 | 输出 |
| --- | --- | --- |
| 浮点常量 | — | `float` |
| 三分量常量 | — | `vec3` |
| UV | — | `vec3(uv, 0)` |
| 时间 | — | `float`（秒，`u_time`） |
| 加 / 乘 | `a, b`（多态，两端须同类型） | 与输入同类型 |
| 插值 | `a:vec3, b:vec3, t:float` | `vec3`（`mix`） |
| 颜色输出 | `color:vec3` | —（唯一，全图至多一个） |

## 架构与需求对照

```
编辑动作                    Worker（排序+代码生成）              主线程（编译+预览）
 editorReducer  ──postMessage──▶ buildWorker.ts        ──消息──▶ previewReducer
 graph + revision              topologicalOrder/buildShaders      GLRenderer.compile
```

- **类型检查与无环连线**（`src/graph/validate.ts`）
  - 拉线松手前 `checkCanConnect`：端口存在性、自连/成环（`reaches`）、
    类型匹配（在“候选连线已替换旧线”的假设下做递归类型推导）。
  - Worker 端 `validateGraph` 再整图校验一次（防御纵深）。
  - 环检测只覆盖**颜色输出可达子图**（沿入边向上游 DFS 上色）；
    断开的环组件不报错，断开节点不参与编译。
  - 每个输入端口单连线，新连线替换旧线；节点上限 50，输出节点唯一。

- **修订（revision）与迟到结果**（`src/state/previewMachine.ts`）
  - 结构/常量编辑单调递增 `revision`；移动节点位置不影响着色器，不递增。
  - Worker 结果（`workerResult/workerError`）与 GLSL 编译结果
    （`compiled/compileFailed`）都必须 `revision === graphRevision`，
    否则原样丢弃，旧修订无法覆盖新修订。
  - 编译请求另有单调递增 `compileNonce`，编辑后旧 nonce 的异步回调作废。
  - 更新期间旧画面继续显示但状态栏标记“旧修订”；图非法时显示错误。

- **WebGL 上下文丢失/恢复**（`src/webgl/GLRenderer.ts`）
  - `webglcontextlost` 中 `preventDefault()`，状态机置 `contextLost`、
    清空 `displayedRevision/renderedGraph`，预览上覆盖“预览失效”遮罩并停止绘制。
  - `webglcontextrestored` 后重建 buffer，并用**当前修订**重新构建/编译
    （缓存的同修订产物直接重编译，否则重新走 Worker），绝不回显旧画面。

- **导出一致性**
  - 导出闸门 `isInSync`：上下文未丢失、编译就绪、
    `displayedRevision === graphRevision` 且有图快照。
  - “导出图 + 截图”为一次原子操作：JSON（含 `revision`、`graph`）与 PNG
    截图取同一修订，文件名都带修订号；不同步时按钮禁用/操作被拒。

## 测试

- `test/validate.test.ts` — 类型错误、泛型一致、环、断开子图、上限/唯一/缺线
- `test/codegen.test.ts` — 拓扑序（依赖在前、输出在末、不含孤点）、环返回 null、GLSL 内容
- `test/staleResults.test.ts` — 迟到 Worker/编译结果、连续编辑、错误修订恢复
- `test/contextRecovery.test.ts` — 丢失标记、丢失期间回调、恢复重建当前图、导出闸门
