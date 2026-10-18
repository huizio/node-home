import { execFile } from "child_process";
import { promisify } from "util";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { EdgeBookmarkReader } from "@/utils/edge-bookmark";
import { TaskQueue } from "@/utils/task-queue";
import type { Bookmark } from "@/types";
import type { LiveBookmarkRow, LiveRoomStatus } from "./types";
import {
  LIVE_BOOKMARK_PROCESS_INTERVAL_MS,
  LIVE_FOLDER_NAME,
  LIVE_NOTIFY_APP_ID,
  LIVE_PROXY_URL,
  LIVE_REQUEST_COOKIE,
  LIVE_REQUEST_HEADERS,
  LIVE_SCRAPE_INTERVAL_MS,
} from "./constants";

/** 以 Promise 形式调用 powershell，便于在异步流程中 await / 静默吞掉通知失败。 */
const execFileAsync = promisify(execFile);

/** fetch 返回对象的结构化类型（避免依赖全局 Response 类型声明差异）。 */
interface FetchResponse {
  /** 响应是否成功（状态码 200-299） */
  ok: boolean;
  /** HTTP 状态码 */
  status: number;
  /** 响应头访问器 */
  headers: { get(name: string): string | null };
  /** 以文本形式读取响应体 */
  text(): Promise<string>;
}

/**
 * Live 状态采集服务：以任务队列驱动「每 30 秒扫描一次书签目录、每秒处理一个书签」，
 * 抓取各直播站点的内嵌状态并缓存在内存中，供首屏 SSR 与 WebSocket 快照推送使用。
 */
export class LiveStatusService {
  /** 书签读取器（读取 Edge 书签文件中 live 目录的直接书签）。 */
  private readonly reader = new EdgeBookmarkReader();
  /** 任务队列：承载「主调度」与「逐书签处理」两个任务。 */
  private readonly queue = new TaskQueue();
  /** 待处理书签队列（由主调度刷新，由处理任务逐个取出）。 */
  private pending: Bookmark[] = [];
  /** 书签 id -> 表格行数据（最新抓取结果）。 */
  private readonly rows = new Map<string, LiveBookmarkRow>();
  /** 行数据变更监听器（供 WebSocket 主动推送快照）。 */
  private readonly changeListeners = new Set<(rows: LiveBookmarkRow[]) => void>();
  /** 逐行通知开关：书签 id -> 是否启用状态切换通知（由前端经 WebSocket 设置）。 */
  private readonly notifyEnabledByRow = new Map<string, boolean>();

  /** 启动服务：配置代理（若设置）、注册两个定时任务并开启调度。 */
  start(): void {
    this.setupProxy();

    // 主调度：每 30 秒重新发现 live 目录书签并刷新待处理队列。
    this.queue.add(
      () => {
        void this.refreshBookmarks();
      },
      { id: "live-scrape", intervalMs: LIVE_SCRAPE_INTERVAL_MS, immediate: true },
    );

    // 逐书签处理：每秒从待处理队列取出一个书签抓取状态。
    this.queue.add(
      () => {
        void this.processOneBookmark();
      },
      {
        id: "live-worker",
        intervalMs: LIVE_BOOKMARK_PROCESS_INTERVAL_MS,
        immediate: false,
      },
    );

    this.queue.start();
  }

  /** 停止服务：停止任务队列调度。 */
  stop(): void {
    this.queue.stop();
  }

  /**
   * 直播间在线状态发生切换（在线↔离线）时，弹出 Windows 原生通知。
   * 仅在成功抓取且状态真正变化时调用，获取失败 / 首次抓取不会触发。
   * @param row      发生状态切换的书签行（用于展示名称）
   * @param nowOnline 切换后的在线状态（true=上线，false=离线）
   */
  private async notifyStatusChange(row: LiveBookmarkRow, nowOnline: boolean): Promise<void> {
    const body = nowOnline ? `${row.name} 已开播（在线）` : `${row.name} 已离线`;
    console.log(`[live] 状态切换通知：${body}`);
    await showWindowsToast("直播间状态变更", body);
  }

  /**
   * 配置请求代理。Node 内置 fetch 默认不走系统 / 浏览器代理，而目标站点需经该本地代理
   *（与浏览器远程地址 127.0.0.1:10808 一致）才能拿到真实页面，否则会被拦截。
   * 设置全局 dispatcher 后，内置 fetch 会复用同一代理；未配置 LIVE_PROXY_URL 则跳过。
   */
  private setupProxy(): void {
    if (!LIVE_PROXY_URL) {
      return;
    }
    try {
      setGlobalDispatcher(new ProxyAgent(LIVE_PROXY_URL));
      console.log(`[live] 已设置请求代理：${LIVE_PROXY_URL}`);
    } catch (err) {
      console.error(
        `[live] 代理配置失败（${LIVE_PROXY_URL}）：`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /** 当前全部表格行数据（供首屏 SSR 与 WebSocket 快照推送使用）。 */
  getRows(): LiveBookmarkRow[] {
    return [...this.rows.values()];
  }

  /**
   * 订阅行数据变更，用于 WebSocket 主动推送快照。
   * @param listener 数据变更时回调，入参为当前最新快照
   * @returns 取消订阅函数
   */
  subscribe(listener: (rows: LiveBookmarkRow[]) => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /** 通知所有订阅者当前最新快照。 */
  private emitChange(): void {
    const rows = this.getRows();
    for (const listener of this.changeListeners) {
      listener(rows);
    }
  }

  /** 设置是否启用状态切换的桌面通知（前端经 WebSocket 逐行上报，默认关闭）。 */
  setNotifyEnabled(id: string, enabled: boolean): void {
    if (enabled) {
      this.notifyEnabledByRow.set(id, true);
    } else {
      this.notifyEnabledByRow.delete(id);
    }
    console.log(`[live] 通知开关（${id}）已${enabled ? "开启" : "关闭"}`);
  }

  /** 判断指定书签是否开启了状态切换通知。 */
  private isNotifyEnabled(id: string): boolean {
    return this.notifyEnabledByRow.get(id) === true;
  }

  /**
   * 主调度任务：重新读取 live 目录书签，重建行数据与待处理队列。
   * 已不存在的书签会从表格中移除，新增/变化的书签进入待处理队列。
   */
  private async refreshBookmarks(): Promise<void> {
    let bookmarks: Bookmark[];
    try {
      bookmarks = await this.reader.getDirectBookmarksByFolderName(LIVE_FOLDER_NAME);
    } catch (err) {
      // 读取书签失败（如文件缺失）不阻断调度，仅打印日志。
      console.error("[live] 读取书签失败：", err instanceof Error ? err.message : err);
      return;
    }
    console.log(`[live] 主调度完成：发现 ${bookmarks.length} 个 live 书签，待处理队列已刷新。`);

    const seen = new Set<string>();
    for (const bm of bookmarks) {
      seen.add(bm.id);
      const existing = this.rows.get(bm.id);
      if (existing) {
        // 更新标题/地址（可能变化），保留已抓取的状态
        existing.name = bm.name;
        existing.url = bm.url;
      } else {
        this.rows.set(bm.id, {
          id: bm.id,
          name: bm.name,
          url: bm.url,
          state: "pending",
        });
      }
    }
    // 移除已不在目录中的书签
    for (const id of [...this.rows.keys()]) {
      if (!seen.has(id)) {
        this.rows.delete(id);
      }
    }
    // 清理已不存在书签的通知开关，避免映射无限增长
    for (const id of [...this.notifyEnabledByRow.keys()]) {
      if (!seen.has(id)) {
        this.notifyEnabledByRow.delete(id);
      }
    }
    // 重建待处理队列（本轮需要逐个抓取的完整列表）
    this.pending = [...bookmarks];
    // 书签集合可能已增删，通知订阅者刷新快照。
    this.emitChange();
  }

  /** 处理任务：从待处理队列取出一个书签并抓取其直播间状态。 */
  private async processOneBookmark(): Promise<void> {
    const bm = this.pending.shift();
    if (!bm) {
      return; // 队列已空，等待下一次主调度
    }
    const row = this.rows.get(bm.id);
    if (!row) {
      return;
    }
    console.log(`[live] 开始处理书签：${row.name} <${bm.url}>`);
    row.state = "pending";

    try {
      const html = await this.fetchLiveHtml(bm.url);
      const status = parseLiveRoomStatus(html);
      if (status) {
        // 记录变更前的在线状态，用于判断是否发生了「在线↔离线」切换。
        const prevOnline = row.status?.isOnline;
        row.state = "fetched";
        row.status = status;
        row.fetchedAt = Date.now();
        row.error = undefined;
        console.log(
          `[live] 书签处理成功：${row.name} | 在线=${status.isOnline} 屏蔽=${status.isBlocked} 状态="${status.offlineStatus}" 更新时间=${status.offlineStatusUpdatedAt}`,
        );
        // 仅在「成功抓取、在线状态发生切换且该行开启了通知」时通知；
        // 失败 / 首次抓取 / 状态未变 / 通知关闭均不通知。
        if (prevOnline !== undefined && prevOnline !== status.isOnline && this.isNotifyEnabled(row.id)) {
          void this.notifyStatusChange(row, status.isOnline);
        }
      } else {
        row.state = "notfound";
        row.error = "页面中未找到 offlineStatusUpdatedAt";
        console.warn(`[live] 书签未找到状态：${row.name} <${bm.url}>（页面中无 offlineStatusUpdatedAt）`);
      }
    } catch (err) {
      row.state = "error";
      row.error = err instanceof Error ? err.message : String(err);
      console.error(`[live] 书签处理失败：${row.name} <${bm.url}>`, err instanceof Error ? err.message : err);
    }
    // 本行状态已更新，通知订阅者刷新快照（供 WebSocket 推送）。
    this.emitChange();
  }

  /**
   * 请求书签地址并取回 HTML 文本。
   * 会检测响应是否为 HTML 文档（content-type），非 HTML 视为异常。
   * @param url 书签地址
   * @returns HTML 文档文本
   */
  private async fetchLiveHtml(url: string): Promise<string> {
    // 结构化类型描述 fetch 返回对象，避免依赖全局 Response 类型声明差异。
    const res = (await fetch(url, {
      headers: buildRequestHeaders(),
    })) as FetchResponse;
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    // 检测：响应必须是 HTML 文档，否则说明拿到了非预期内容（如 JSON / 重定向页）。
    if (!contentType.includes("text/html")) {
      throw new Error(`非 HTML 文档：${contentType || "unknown"}`);
    }
    return res.text();
  }
}

/**
 * 弹出 Windows 原生 Toast 通知（基于 Windows.UI.Notifications，无需第三方依赖）。
 * 将整段 PowerShell 脚本以 UTF-16LE 做 Base64 编码后通过 -EncodedCommand 传入；
 * -EncodedCommand 不能与 -Args 共用，故标题 / 正文经环境变量 TOAST_TITLE / TOAST_BODY
 * 传入，规避引号、换行等字符对命令行解析的干扰。
 * @param title 通知标题
 * @param body  通知正文
 */
export async function showWindowsToast(title: string, body: string): Promise<void> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$texts = $template.GetElementsByTagName('text')
$texts.Item(0).AppendChild($template.CreateTextNode($env:TOAST_TITLE)) | Out-Null
$texts.Item(1).AppendChild($template.CreateTextNode($env:TOAST_BODY)) | Out-Null
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${LIVE_NOTIFY_APP_ID}')
$notifier.Show($toast)
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  try {
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { env: { ...process.env, TOAST_TITLE: title, TOAST_BODY: body } },
    );
  } catch (err) {
    // 通知失败（如无桌面会话 / 权限受限）不影响主流程，仅记录日志。
    console.error("[live] Windows 通知发送失败：", err instanceof Error ? err.message : err);
  }
}

/** 构造请求头：注入浏览器模拟头，并在配置了 Cookie 时附加。 */
function buildRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = { ...LIVE_REQUEST_HEADERS };
  if (LIVE_REQUEST_COOKIE) {
    headers.cookie = LIVE_REQUEST_COOKIE;
  }
  return headers;
}

/**
 * 从 HTML 文档中解析出包含 offlineStatusUpdatedAt 字段的直播间状态对象。
 * 采用「括号匹配」定位该字段所在的最外层 JSON 对象，避免被嵌套结构干扰，
 * 并对可能存在的尾随逗号做容错处理后 JSON.parse。
 * @param html 页面 HTML 文本
 * @returns 解析出的状态对象；未找到则返回 null
 */
function parseLiveRoomStatus(html: string): LiveRoomStatus | null {
  const objStr = extractObjectContainingKey(html, "offlineStatusUpdatedAt");
  if (!objStr) {
    return null;
  }
  // 容错：移除对象/数组前的尾随逗号（部分页面 JSON 不严格）
  const cleaned = objStr.replace(/,(\s*[}\]])/g, "$1");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    return null;
  }
  return {
    offlineStatus: typeof raw.offlineStatus === "string" ? raw.offlineStatus : "",
    offlineStatusUpdatedAt:
      typeof raw.offlineStatusUpdatedAt === "string" ? raw.offlineStatusUpdatedAt : "",
    isOnline: raw.isOnline === true,
    isBlocked: raw.isBlocked === true,
    avatarUrl: typeof raw.avatarUrl === "string" ? raw.avatarUrl : "",
    avatarUrlThumb: typeof raw.avatarUrlThumb === "string" ? raw.avatarUrlThumb : "",
    avatarUrlOriginal: typeof raw.avatarUrlOriginal === "string" ? raw.avatarUrlOriginal : "",
  };
}

/**
 * 在文本中找到包含指定 key 的最外层 JSON 对象字符串。
 * 从 key 位置向左逐个尝试 `{`，找到「匹配右括号在 key 之后」的最外层 `{` 即目标对象起点。
 * @param text 待搜索文本
 * @param key  目标字段名（不含引号）
 * @returns 对象字符串（含花括号）；未找到返回 null
 */
function extractObjectContainingKey(text: string, key: string): string | null {
  const keyToken = `"${key}"`;
  const keyIdx = text.indexOf(keyToken);
  if (keyIdx === -1) {
    return null;
  }
  for (let start = keyIdx; start >= 0; start--) {
    if (text[start] === "{") {
      const end = matchBrace(text, start);
      // 闭合括号必须在 key 之后，才算包含该 key 的对象
      if (end !== -1 && end > keyIdx) {
        return text.slice(start, end + 1);
      }
    }
  }
  return null;
}

/** 从 `{` 位置出发，跳过字符串内容，找到与之匹配的右 `}` 下标；失败返回 -1。 */
function matchBrace(text: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      // 跳过字符串（含转义），避免误判其中的括号
      i++;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return -1;
}
