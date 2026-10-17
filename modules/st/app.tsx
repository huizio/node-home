import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Bookmark } from "@/types";
import { EdgeBookmarkReader } from "@/utils/edge-bookmark";
import { BOOKMARK_DIY_FOLDER_NAME } from "./constants";

/** 表格单元格统一样式，避免逐个单元格重复书写。 */
const cellStyle: CSSProperties = {
  border: "1px solid #ddd",
  padding: "8px 12px",
  textAlign: "left",
};

/**
 * 首页根组件：接收书签列表并渲染为表格。
 * @param bookmarks DIY 目录下读取到的直接书签
 */
export function App({ bookmarks }: { bookmarks: Bookmark[] }): ReactNode {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>DIY 书签</h1>
      {bookmarks.length === 0 ? (
        <p>
          未找到名为「{BOOKMARK_DIY_FOLDER_NAME}」的目录，或该目录下没有直接书签。
        </p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cellStyle}>名称</th>
              <th style={cellStyle}>地址</th>
            </tr>
          </thead>
          <tbody>
            {bookmarks.map((bm) => (
              <tr key={bm.id}>
                <td style={cellStyle}>{bm.name}</td>
                <td style={cellStyle}>
                  <a href={bm.url} target="_blank">{bm.url}</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * 读取 DIY 目录下的直接书签，并渲染为完整 HTML 文档字符串（含 <!DOCTYPE> 与 <head>）。
 * @returns 完整的 HTML 文本，可直接通过 res.end() 返回
 */
export async function renderDocument(): Promise<string> {
  const reader = new EdgeBookmarkReader();
  const bookmarks = await reader.getDirectBookmarksByFolderName(BOOKMARK_DIY_FOLDER_NAME);
  const body = renderToStaticMarkup(<App bookmarks={bookmarks} />);
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
