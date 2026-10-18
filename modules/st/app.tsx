import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveBookmarkRow } from "./types";

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
  /* 页面最小宽度：窗口更窄时出现横向滚动，避免表格被过度挤压。 */
  min-width: 1040px;
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
}
.controls { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
.control-label { font-size: 14px; color: #1d1d1f; }
.control-divider { width: 1px; height: 18px; background: #d2d2d7; }
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
.interval-input {
  width: 64px; height: 30px; border: 1px solid #d2d2d7; border-radius: 8px;
  padding: 0 10px; font-size: 14px; outline: none;
}
.interval-input:focus { border-color: #0071e3; }
table {
  width: 100%;
  min-width: 1000px;
  /* 固定布局：列宽由下方 nth-child 规则决定，内容溢出时走省略号而非撑开。 */
  table-layout: fixed;
  border-collapse: collapse;
}
/* 各列固定宽度（顺序与表头一致：名称/地址/头像/在线/屏蔽/状态/更新时间）。 */
table col.c-name { width: 160px; }
table col.c-url { width: 260px; }
table col.c-avatar { width: 56px; }
table col.c-online { width: 80px; }
table col.c-block { width: 80px; }
table col.c-status { width: 220px; }
table col.c-time { width: 180px; }
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
      <td>{st?.offlineStatusUpdatedAt ? formatTime(st.offlineStatusUpdatedAt) : ""}</td>
    </tr>
  );
}

/**
 * 首页根组件：渲染控制条（自动刷新开关 + 间隔输入）与状态表格。
 * 实际数据由前端脚本定时轮询 /api/status 刷新，开关与间隔持久化在 localStorage。
 * @param rows 首屏渲染所用的书签状态行（之后由前端轮询覆盖）
 */
export function App({ rows }: { rows: LiveBookmarkRow[] }): ReactNode {
  return (
    <div>
      <h1 className="page-title">Live 状态监控</h1>
      <p className="page-sub">
        每 30 秒扫描 live 目录书签，逐个（每秒一个）抓取直播间状态；下方可开启自动刷新。
      </p>
      <div className="card">
        <div className="controls">
          <label className="switch">
            <input type="checkbox" id="autoToggle" />
            <span className="slider" />
          </label>
          <span className="control-label">自动刷新</span>
          <span className="control-divider" />
          <span className="control-label">间隔</span>
          <input type="number" id="intervalInput" className="interval-input" min={1} step={1} defaultValue={3} />
          <span className="control-label">秒</span>
        </div>
        <table>
          <colgroup>
            <col className="c-name" />
            <col className="c-url" />
            <col className="c-avatar" />
            <col className="c-online" />
            <col className="c-block" />
            <col className="c-status" />
            <col className="c-time" />
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
            </tr>
          </thead>
          <tbody id="rows">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">暂无书签数据</td>
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
 * 前端轮询脚本：连接 /api/status 拉取最新状态并重建表格。
 * 自动刷新开关与轮询间隔保存在 localStorage（默认开启、间隔 3 秒）。
 * 使用字符串拼接而非模板字面量以避免与外层脚本冲突；对外部数据做 HTML 转义防 XSS。
 */
const CLIENT_SCRIPT = `
(function () {
  var tbody = document.getElementById('rows');
  var autoKey = 'liveAutoRefresh';
  var intKey = 'liveRefreshInterval';
  var auto = localStorage.getItem(autoKey);
  auto = auto === null ? true : auto === '1';
  var interval = parseInt(localStorage.getItem(intKey) || '', 10);
  if (isNaN(interval) || interval < 1) interval = 3;
  var timer = null;
  var toggle = document.getElementById('autoToggle');
  var intInput = document.getElementById('intervalInput');
  toggle.checked = auto;
  intInput.value = interval;

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
      tbody.innerHTML = '<tr><td colspan="7" class="empty">暂无书签数据</td></tr>';
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
      html +=
        '<tr>' +
        '<td><span class="ellipsis" title="' + esc(r.name) + '">' + esc(r.name) + '</span></td>' +
        '<td><a class="link" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.url) + '</a></td>' +
        '<td>' + avatarCell + '</td>' +
        '<td>' + onlineBadge + '</td>' +
        '<td>' + blockBadge + '</td>' +
        '<td><span class="ellipsis status-ellipsis" title="' + esc(statusStr) + '">' + esc(statusStr) + '</span></td>' +
        '<td>' + esc(formatTime(st.offlineStatusUpdatedAt)) + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html;
  }
  function poll() {
    fetch('/api/status')
      .then(function (r) { return r.json(); })
      .then(function (data) { render(data.rows || []); })
      .catch(function (e) { console.error('轮询失败', e); });
  }
  function start() {
    stop();
    if (toggle.checked) {
      timer = setInterval(poll, interval * 1000);
    }
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  toggle.addEventListener('change', function () {
    localStorage.setItem(autoKey, toggle.checked ? '1' : '0');
    if (toggle.checked) poll();
    start();
  });
  intInput.addEventListener('change', function () {
    var v = parseInt(intInput.value, 10);
    if (isNaN(v) || v < 1) v = 3;
    interval = v;
    intInput.value = String(v);
    localStorage.setItem(intKey, String(v));
    start();
  });
  // 首屏已有 SSR 内容；立即拉一次最新数据，并按开关决定是否定时轮询。
  poll();
  if (auto) start();
})();
`;
