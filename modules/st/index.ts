import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SERVER_PORT } from "@/constants";
import { renderDocument } from "./app";

/**
 * 处理单个 HTTP 请求：渲染页面并以 text/html 返回。
 * @param _req 入站请求（当前未使用，预留扩展）
 * @param res  服务端响应对象
 */
function handleRequest(_req: IncomingMessage, res: ServerResponse): void {
  const html = renderDocument();
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/** 启动 HTTP 服务，监听 SERVER_PORT 并返回渲染后的 HTML 页面。 */
function setup(): void {
  const server = createServer(handleRequest);
  server.listen(SERVER_PORT, () => {
    console.log(`[st] server running at http://localhost:${SERVER_PORT}/`);
  });
}

export { setup };
