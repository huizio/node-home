import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveBookmarkRow } from "./types";
import { LIVE_NOTIFY_STORAGE_KEY, LIVE_WS_PATH } from "./constants";

/** 标签（badge）配色类型：green=绿、gray=灰、red=红。 */
type BadgeKind = "green" | "gray" | "red";

/** Apple 风格页面样式（系统字体、圆角卡片、细分隔线、胶囊标签）。 */
const PAGE_CSS = `
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue",
    "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  background: #f5f5f7;
  color: #1d1d1f;
  padding: 32px;
  /* Firefox 滚动条美化（细窄 + 配色）。 */
  scrollbar-width: thin;
  scrollbar-color: #c7c7cc #f0f0f2;
}
.page-title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
.page-sub { color: #6e6e73; font-size: 14px; margin: 0 0 20px; }
.card {
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  padding: 20px 24px;
  /* 窄屏时表格可在卡片内横向滚动，作为响应式兜底（不限制版心最小宽度）。 */
  overflow-x: auto;
}
.switch { position: relative; display: inline-block; width: 46px; height: 28px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
  position: absolute; cursor: pointer; inset: 0;
  background: #e8e8ed; border-radius: 999px; transition: background 0.25s;
}
.slider:before {
  content: ""; position: absolute; height: 24px; width: 24px; left: 2px; top: 2px;
  background: #fff; border-radius: 50%; transition: transform 0.25s;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
}
.switch input:checked + .slider { background: #34c759; }
.switch input:checked + .slider:before { transform: translateX(18px); }
/* 表格内嵌的紧凑开关（用于逐行通知控制）。 */
.switch-sm { width: 36px; height: 20px; }
.switch-sm .slider:before {
  height: 16px; width: 16px; left: 2px; top: 2px;
}
.switch-sm input:checked + .slider:before { transform: translateX(16px); }
table {
  width: 100%;
  /* 固定布局 + 弹性列宽：窄列用固定像素、宽列用百分比，使表格填满视口而非固定最小宽度。 */
  table-layout: fixed;
  border-collapse: collapse;
}
/* 各列宽度（顺序与表头一致：名称/地址/头像/在线/屏蔽/状态/更新时间/通知）。
   小列用像素保底，大列用百分比随视口伸缩；内容溢出时走省略号而非撑开。 */
table col.c-name { width: 20%; }
table col.c-url { width: 32%; }
table col.c-avatar { width: 48px; }
table col.c-online { width: 64px; }
table col.c-block { width: 64px; }
table col.c-status { width: 24%; }
table col.c-time { width: 130px; }
table col.c-notify { width: 72px; }
thead th {
  text-align: left; font-size: 12px; font-weight: 600; color: #6e6e73;
  padding: 10px 14px; border-bottom: 1px solid #d2d2d7; background: #fafafa;
}
thead th:first-child { border-top-left-radius: 10px; }
thead th:last-child { border-top-right-radius: 10px; }
tbody td {
  padding: 12px 14px; font-size: 14px; border-bottom: 1px solid #f0f0f2;
  vertical-align: middle;
}
.cell-notify { text-align: center; }
.cell-time { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
tbody tr:last-child td { border-bottom: none; }
tbody tr:hover { background: #fafafa; }
.ellipsis {
  display: block; max-width: 100%; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom;
}
.status-ellipsis { max-width: 100%; }
.avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #f0f0f2; }
.badge {
  display: inline-block; padding: 3px 12px; border-radius: 999px;
  font-size: 12px; font-weight: 600; line-height: 1.4;
}
.badge-green { background: rgba(52, 199, 89, 0.15); color: #1a8a3a; }
.badge-gray { background: #e8e8ed; color: #6e6e73; }
.badge-red { background: rgba(255, 59, 48, 0.15); color: #d70015; }
.link { color: #0071e3; text-decoration: none; }
.link:hover { text-decoration: underline; }
.empty { text-align: center; color: #86868b; padding: 40px 0; }
/* WebKit 滚动条美化（Chrome / Edge / Safari）：细圆角、hover 加深。 */
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: #f0f0f2; border-radius: 6px; }
::-webkit-scrollbar-thumb { background: #c7c7cc; border-radius: 6px; }
::-webkit-scrollbar-thumb:hover { background: #aeaeb2; }
`;

/** 计算书签行的状态展示文案（首屏 SSR 与前端脚本共用逻辑）。 */
function statusText(row: LiveBookmarkRow): string {
  if (row.state === "error") return `错误: ${row.error ?? ""}`;
  if (row.state === "notfound") return "未找到状态";
  if (row.state === "pending") return "获取中…";
  if (!row.status) return "-";
  return row.status.isOnline ? "直播中" : `离线: ${row.status.offlineStatus}`;
}

/** 将 ISO 时间格式化为 UTC+8（北京时区）可读字符串。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

/** 单个胶囊标签。 */
function Badge({ kind, text }: { kind: BadgeKind; text: string }): ReactNode {
  return <span className={`badge badge-${kind}`}>{text}</span>;
}

/** 单行展示组件（首屏 SSR 用，与前端脚本渲染保持一致）。 */
function Row({ row }: { row: LiveBookmarkRow }): ReactNode {
  const st = row.status;
  const avatar = st?.avatarUrlThumb || st?.avatarUrl || "";
  const onlineBadge = st ? (
    <Badge kind={st.isOnline ? "green" : "gray"} text={st.isOnline ? "在线" : "离线"} />
  ) : (
    <Badge kind="gray" text="-" />
  );
  const blockBadge = st ? (
    <Badge kind={st.isBlocked ? "red" : "gray"} text={st.isBlocked ? "已屏蔽" : "正常"} />
  ) : (
    <Badge kind="gray" text="-" />
  );
  const statusStr = statusText(row);
  return (
    <tr key={row.id}>
      <td>
        <span className="ellipsis" title={row.name}>{row.name}</span>
      </td>
      <td>
        <a className="link" href={row.url} target="_blank" rel="noopener">{row.url}</a>
      </td>
      <td>{avatar ? <img className="avatar" src={avatar} alt="avatar" /> : null}</td>
      <td>{onlineBadge}</td>
      <td>{blockBadge}</td>
      <td>
        <span className="ellipsis status-ellipsis" title={statusStr}>{statusStr}</span>
      </td>
      <td className="cell-time">{st?.offlineStatusUpdatedAt ? formatTime(st.offlineStatusUpdatedAt) : ""}</td>
      <td className="cell-notify">
        <label className="switch switch-sm">
          <input type="checkbox" className="notify-switch" data-id={row.id} />
          <span className="slider" />
        </label>
      </td>
    </tr>
  );
}

/**
 * 首页根组件：渲染状态表格，每行带独立的「通知」开关（逐行控制是否弹窗）。
 * 实际数据由前端经 WebSocket 实时推送刷新，逐行通知开关持久化在 localStorage。
 * @param rows 首屏渲染所用的书签状态行（之后由 WebSocket 推送覆盖）
 */
export function App({ rows }: { rows: LiveBookmarkRow[] }): ReactNode {
  return (
    <div className="page">
      <h1 className="page-title">状态监控</h1>

      <div className="card">
        <table>
          <colgroup>
            <col className="c-name" />
            <col className="c-url" />
            <col className="c-avatar" />
            <col className="c-online" />
            <col className="c-block" />
            <col className="c-status" />
            <col className="c-time" />
            <col className="c-notify" />
          </colgroup>
          <thead>
            <tr>
              <th>名称</th>
              <th>地址</th>
              <th>头像</th>
              <th>在线</th>
              <th>屏蔽</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>通知</th>
            </tr>
          </thead>
          <tbody id="rows">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty">暂无书签数据</td>
              </tr>
            ) : (
              rows.map((row) => <Row key={row.id} row={row} />)
            )}
          </tbody>
        </table>
      </div>
      <script dangerouslySetInnerHTML={{ __html: CLIENT_SCRIPT }} />
    </div>
  );
}

/**
 * 读取书签状态行，并渲染为完整 HTML 文档字符串（含 <!DOCTYPE>、<head> 与 Apple 风格样式）。
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
  <style>${PAGE_CSS}</style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * 前端脚本：通过 WebSocket 接收服务端实时快照并重建表格，并维护逐行「通知」开关。
 * 每行独立控制、默认关闭，开关状态以 id -> 是否启用 的映射持久化于 localStorage；
 * 切换或连接建立时经 WebSocket 逐行上报服务端，服务端据此决定是否弹窗。对外部数据做 HTML 转义防 XSS。
 */
const CLIENT_SCRIPT = `
(function () {
  var tbody = document.getElementById('rows');
  var notifyKey = '${LIVE_NOTIFY_STORAGE_KEY}';
  var ws = null;

  // 逐行通知开关：id -> 是否启用的映射（默认全关）。
  var notifyMap = {};
  try {
    notifyMap = JSON.parse(localStorage.getItem(notifyKey) || '{}') || {};
  } catch (e) {
    notifyMap = {};
  }
  function saveNotify() {
    localStorage.setItem(notifyKey, JSON.stringify(notifyMap));
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function badge(kind, text) {
    return '<span class="badge badge-' + kind + '">' + esc(text) + '</span>';
  }
  function statusText(r) {
    if (r.state === 'error') return '错误: ' + r.error;
    if (r.state === 'notfound') return '未找到状态';
    if (r.state === 'pending') return '获取中…';
    if (!r.status) return '-';
    return r.status.isOnline ? '直播中' : ('离线: ' + r.status.offlineStatus);
  }
  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    try {
      return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    } catch (e) {
      return iso;
    }
  }
  function render(rows) {
    if (!rows || !rows.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty">暂无书签数据</td></tr>';
      return;
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var st = r.status || {};
      var avatar = st.avatarUrlThumb || st.avatarUrl || '';
      var avatarCell = avatar ? '<img class="avatar" src="' + esc(avatar) + '" alt="avatar" />' : '';
      var onlineKind = st.isOnline ? 'green' : 'gray';
      var blockKind = st.isBlocked ? 'red' : 'gray';
      var onlineBadge = st.isOnline !== undefined ? badge(onlineKind, st.isOnline ? '在线' : '离线') : badge('gray', '-');
      var blockBadge = st.isBlocked !== undefined ? badge(blockKind, st.isBlocked ? '已屏蔽' : '正常') : badge('gray', '-');
      var statusStr = statusText(r);
      var notifyOn = notifyMap[r.id] === true;
      html +=
        '<tr>' +
        '<td><span class="ellipsis" title="' + esc(r.name) + '">' + esc(r.name) + '</span></td>' +
        '<td><a class="link" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a></td>' +
        '<td>' + avatarCell + '</td>' +
        '<td>' + onlineBadge + '</td>' +
        '<td>' + blockBadge + '</td>' +
        '<td><span class="ellipsis status-ellipsis" title="' + esc(statusStr) + '">' + esc(statusStr) + '</span></td>' +
        '<td class="cell-time">' + esc(formatTime(st.offlineStatusUpdatedAt)) + '</td>' +
        '<td class="cell-notify"><label class="switch switch-sm"><input type="checkbox" class="notify-switch" data-id="' + esc(r.id) + '"' + (notifyOn ? ' checked' : '') + '/><span class="slider"></span></label></td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
  }

  // 更新某行的通知开关：本地映射 + 持久化 + 经 WebSocket 上报服务端。
  function setNotify(id, enabled) {
    if (enabled) notifyMap[id] = true;
    else delete notifyMap[id];
    saveNotify();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'setNotify', id: id, enabled: enabled }));
    }
  }

  // 事件委托：表格内任意通知开关切换统一由 tbody 处理（innerHTML 重建后依然有效）。
  tbody.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('notify-switch')) {
      setNotify(t.getAttribute('data-id'), t.checked);
    }
  });

  // 建立 WebSocket：接收快照渲染，断线后自动重连。
  function connect() {
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host + '${LIVE_WS_PATH}');
    ws.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg && msg.type === 'snapshot') render(msg.rows || []);
      } catch (e) { /* 忽略非法消息 */ }
    };
    ws.onopen = function () {
      // 连接建立后，将本地全部逐行通知开关上报服务端（覆盖重连后的服务端状态）。
      for (var id in notifyMap) {
        if (Object.prototype.hasOwnProperty.call(notifyMap, id)) {
          ws.send(JSON.stringify({ type: 'setNotify', id: id, enabled: notifyMap[id] }));
        }
      }
    };
    ws.onclose = function () {
      setTimeout(connect, 2000);
    };
    ws.onerror = function () {
      ws.close();
    };
  }
  connect();
})();
`;
