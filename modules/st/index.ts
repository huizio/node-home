import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SERVER_PORT } from "./constants";
import { renderDocument } from "./app";
import { LiveStatusService } from "./live-status.service";

/**
 * 处理首屏页面请求：渲染当前书签状态行并以 text/html 返回。
 * 渲染过程中若读取数据失败，返回 500 及错误信息，避免进程崩溃。
 * @param res 服务端响应对象
 * @param service 直播状态服务（提供当前快照）
 */
async function handlePage(res: ServerResponse, service: LiveStatusService): Promise<void> {
  try {
    const html = await renderDocument(service.getRows());
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`渲染失败：${message}`);
  }
}

/** 启动 HTTP 服务：提供首屏页面与 SSE 实时更新端点，并启动状态采集。 */
function setup(): void {
  const service = new LiveStatusService();
  service.start();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url?.startsWith("/api/events")) {
      service.handleSse(req, res);
    } else {
      void handlePage(res, service);
    }
  });
  server.listen(SERVER_PORT, () => {
    console.log(`[st] server running at http://localhost:${SERVER_PORT}/`);
  });
}

export { setup };
