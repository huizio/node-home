import type { CSSProperties, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveBookmarkRow } from "./types";

/** 表格单元格统一样式，避免逐个单元格重复书写。 */
const cellStyle: CSSProperties = {
  border: "1px solid #ddd",
  padding: "8px 12px",
  textAlign: "left",
};

/**
 * 计算书签行的状态展示文案（与前端 SSE 脚本保持一致的逻辑，用于首屏 SSR）。
 * @param row 表格行数据
 * @returns 给「状态」列展示的中文文案
 */
function statusText(row: LiveBookmarkRow): string {
  if (row.state === "error") return `错误: ${row.error ?? ""}`;
  if (row.state === "notfound") return "未找到状态";
  if (row.state === "pending") return "获取中…";
  if (!row.status) return "-";
  return row.status.isOnline ? "直播中" : `离线: ${row.status.offlineStatus}`;
}

/** 单行展示组件。 */
function Row({ row }: { row: LiveBookmarkRow }): ReactNode {
  const st = row.status;
  const avatar = st?.avatarUrlThumb || st?.avatarUrl || "";
  return (
    <tr key={row.id}>
      <td style={cellStyle}>{row.name}</td>
      <td style={cellStyle}>
        <a href={row.url} target="_blank" rel="noopener">{row.url}</a>
      </td>
      <td style={cellStyle}>
        {avatar ? (
          <img src={avatar} width={40} height={40} style={{ borderRadius: "50%" }} alt="avatar" />
        ) : null}
      </td>
      <td style={cellStyle}>{st?.isOnline ? "在线" : st ? "离线" : "-"}</td>
      <td style={cellStyle}>{st?.isBlocked ? "已屏蔽" : st ? "正常" : "-"}</td>
      <td style={cellStyle}>{statusText(row)}</td>
      <td style={cellStyle}>{st?.offlineStatusUpdatedAt ?? ""}</td>
    </tr>
  );
}

/**
 * 首页根组件：接收书签状态行并渲染为表格，并内嵌 SSE 客户端脚本实时刷新。
 * @param rows 首屏渲染所用的书签状态行（之后由 SSE 增量更新）
 */
export function App({ rows }: { rows: LiveBookmarkRow[] }): ReactNode {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Live 状态监控</h1>
      <p style={{ color: "#666" }}>
        每 30 秒扫描 live 目录书签，逐个（每秒一个）抓取直播间状态，通过 SSE 实时刷新。
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={cellStyle}>名称</th>
            <th style={cellStyle}>地址</th>
            <th style={cellStyle}>头像</th>
            <th style={cellStyle}>在线</th>
            <th style={cellStyle}>屏蔽</th>
            <th style={cellStyle}>状态</th>
            <th style={cellStyle}>更新时间</th>
          </tr>
        </thead>
        <tbody id="rows">
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </tbody>
      </table>
      <script dangerouslySetInnerHTML={{ __html: SSE_CLIENT_SCRIPT }} />
    </div>
  );
}

/**
 * 读取书签状态行，并渲染为完整 HTML 文档字符串（含 <!DOCTYPE> 与 <head>）。
 * @param rows 当前书签状态行（来自 LiveStatusService 的快照）
 * @returns 完整的 HTML 文本，可直接通过 res.end() 返回
 */
export function renderDocument(rows: LiveBookmarkRow[]): string {
  const body = renderToStaticMarkup(<App rows={rows} />);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Live 状态监控</title>
</head>
<body>${body}</body>
</html>`;
}

/**
 * SSE 客户端脚本：连接 /api/events，收到 snapshot / update 事件后用最新数据
 * 重建表格 tbody。使用字符串拼接而非模板字面量以避免与外层脚本冲突，
 * 并对外部站点数据做 HTML 转义，防止 XSS。
 */
const SSE_CLIENT_SCRIPT = `
(function () {
  var tbody = document.getElementById('rows');
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function statusText(r) {
    if (r.state === 'error') return '错误: ' + r.error;
    if (r.state === 'notfound') return '未找到状态';
    if (r.state === 'pending') return '获取中…';
    if (!r.status) return '-';
    return r.status.isOnline ? '直播中' : ('离线: ' + r.status.offlineStatus);
  }
  function render(rows) {
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var st = r.status || {};
      var avatar = st.avatarUrlThumb || st.avatarUrl || '';
      var avatarCell = avatar
        ? '<img src="' + esc(avatar) + '" width="40" height="40" style="border-radius:50%" alt="avatar" />'
        : '';
      var online = st.isOnline ? '在线' : (r.status ? '离线' : '-');
      var blocked = st.isBlocked ? '已屏蔽' : (r.status ? '正常' : '-');
      html +=
        '<tr>' +
        '<td>' + esc(r.name) + '</td>' +
        '<td><a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a></td>' +
        '<td>' + avatarCell + '</td>' +
        '<td>' + online + '</td>' +
        '<td>' + blocked + '</td>' +
        '<td>' + esc(statusText(r)) + '</td>' +
        '<td>' + esc(st.offlineStatusUpdatedAt || '') + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
  }
  var es = new EventSource('/api/events');
  es.addEventListener('snapshot', function (e) { render(JSON.parse(e.data).rows); });
  es.addEventListener('update', function (e) { render(JSON.parse(e.data).rows); });
})();
`;
