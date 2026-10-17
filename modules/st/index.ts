import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { SERVER_PORT } from "./constants";
import { renderDocument } from "./app";
import { LiveStatusService } from "./live-status.service";

/**
 * 处理首屏页面请求：渲染当前书签状态行并以 text/html 返回。
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

/**
 * 处理状态轮询请求：返回当前全部书签状态行的 JSON 快照（供前端定时刷新）。
 * @param res 服务端响应对象
 * @param service 直播状态服务
 */
function handleStatus(res: ServerResponse, service: LiveStatusService): void {
  const payload = JSON.stringify({ rows: service.getRows() });
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(payload);
}

/** 启动 HTTP 服务：提供首屏页面与状态轮询端点，并启动状态采集。 */
function setup(): void {
  const service = new LiveStatusService();
  service.start();

  const server = createServer((req, res) => {
    if (req.url?.startsWith("/api/status")) {
      handleStatus(res, service);
    } else {
      void handlePage(res, service);
    }
  });
  server.listen(SERVER_PORT, () => {
    console.log(`[st] server running at http://localhost:${SERVER_PORT}/`);
  });
}

export { setup };
