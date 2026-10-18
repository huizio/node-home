import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import { LIVE_WS_PATH, SERVER_PORT } from "./constants";
import { renderDocument } from "./app";
import { LiveStatusService, showWindowsToast } from "./live-status.service";
import { WebSocketHub } from "@/utils/ws-server";
import type { ClientWsMessage, ServerWsMessage } from "./types";

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
 * 优雅关闭：停止采集与 HTTP 服务，并发送关闭通知。
 * @param service 直播状态服务
 * @param server  HTTP 服务实例
 */
async function shutdown(service: LiveStatusService, server: ReturnType<typeof createServer>): Promise<void> {
  console.log("[st] 收到关闭信号，正在停止服务……");
  service.stop();
  server.close();
  await showWindowsToast("直播间监控已停止", `服务已关闭（端口 ${SERVER_PORT}）`);
  process.exit(0);
}

/**
 * 启动 HTTP 服务：提供首屏页面，并以 WebSocket 推送状态快照；
 * 前端连接后上报通知开关，服务端据此决定是否弹窗通知。
 */
function setup(): void {
  const service = new LiveStatusService();
  service.start();

  const server = createServer((_req, res) => {
    void handlePage(res, service);
  });

  const hub = new WebSocketHub(LIVE_WS_PATH);
  hub.attach(server);

  // 新连接建立后立即推送一次全量快照（首屏之后的实时起点）。
  hub.onConnection((client) => {
    const msg: ServerWsMessage = { type: "snapshot", rows: service.getRows() };
    client.send(JSON.stringify(msg));
  });

  // 处理客户端上行消息（如通知开关）。
  hub.onMessage((_client, data) => {
    let msg: ClientWsMessage;
    try {
      msg = JSON.parse(data) as ClientWsMessage;
    } catch {
      return;
    }
    if (msg.type === "setNotify") {
      service.setNotifyEnabled(msg.enabled);
    }
  });

  // 行数据变更时主动向所有客户端推送最新快照。
  service.subscribe((rows) => {
    const msg: ServerWsMessage = { type: "snapshot", rows };
    hub.broadcast(JSON.stringify(msg));
  });

  server.listen(SERVER_PORT, () => {
    console.log(`[st] server running at http://localhost:${SERVER_PORT}/`);
    // 服务启动成功后通知用户。
    void showWindowsToast("直播间监控已启动", `服务已运行在 http://localhost:${SERVER_PORT}/`);
  });

  // 监听终止信号，优雅关闭并通知。
  process.on("SIGINT", () => void shutdown(service, server));
  process.on("SIGTERM", () => void shutdown(service, server));
}

export { setup };
