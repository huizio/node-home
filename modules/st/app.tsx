import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * 首页根组件，由 React 在服务端渲染为静态 HTML 片段。
 * 后续页面只需在此处组合更多组件即可，无需手写 HTML 字符串。
 */
export function App(): ReactNode {
  const title = "Node Home";
  const items: string[] = ["书签管理", "任务队列", "系统状态"];

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>{title}</h1>
      <p>这是通过 React SSR 在服务端渲染的页面。</p>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 将根组件渲染为完整 HTML 文档字符串（含 <!DOCTYPE> 与 <head>）。
 * @returns 完整的 HTML 文本，可直接通过 res.end() 返回
 */
export function renderDocument(): string {
  const body = renderToStaticMarkup(<App />);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Node Home</title>
</head>
<body>${body}</body>
</html>`;
}
