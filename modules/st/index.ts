import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SERVER_PORT } from "@/constants";
import { renderDocument } from "./app";

/**
 * 处理单个 HTTP 请求：渲染书签页面并以 text/html 返回。
 * 渲染过程中若读取书签失败，返回 500 及错误信息，避免进程崩溃。
 * @param _req 入站请求（当前未使用，预留扩展）
 * @param res  服务端响应对象
 */
async function handleRequest(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const html = await renderDocument();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`渲染失败：${message}`);
  }
}

/** 启动 HTTP 服务，监听 SERVER_PORT 并返回渲染后的 HTML 页面。 */
function setup(): void {
  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });
  server.listen(SERVER_PORT, () => {
    console.log(`[st] server running at http://localhost:${SERVER_PORT}/`);
  });
}

export { setup };
