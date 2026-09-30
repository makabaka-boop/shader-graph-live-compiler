// 排序 + 代码生成 Worker。
// 主线程每次修订发送 { revision, graph }，worker 不做节流、按消息顺序处理；
// 迟到结果由主线程的修订号守卫丢弃，worker 自身不关心新旧。
import { buildShaders, BuildRequest, BuildResponse } from '../graph/codegen';

self.onmessage = (ev: MessageEvent<BuildRequest>) => {
  const msg = ev.data;
  if (msg.type !== 'build') return;
  const response = (payload: BuildResponse) =>
    (self.postMessage as (m: BuildResponse) => void)(payload);
  try {
    const result = buildShaders(msg.graph);
    response({ type: 'buildResult', revision: msg.revision, result });
  } catch (err) {
    response({
      type: 'buildError',
      revision: msg.revision,
      message: err instanceof Error ? err.message : String(err)
    });
  }
};
