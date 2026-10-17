import type { IncomingMessage, ServerResponse } from "node:http";
import { ProxyAgent, setGlobalDispatcher } from "undici";
import { EdgeBookmarkReader } from "@/utils/edge-bookmark";
import { TaskQueue } from "@/utils/task-queue";
import type { Bookmark } from "@/types";
import type { LiveBookmarkRow, LiveRoomStatus, LiveSnapshot } from "./types";
import {
  LIVE_BOOKMARK_PROCESS_INTERVAL_MS,
  LIVE_FOLDER_NAME,
  LIVE_PROXY_URL,
  LIVE_REQUEST_COOKIE,
  LIVE_REQUEST_HEADERS,
  LIVE_SCRAPE_INTERVAL_MS,
} from "./constants";

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

/** SSE 事件名：首屏快照与后续增量更新共用同一数据格式。 */
const SSE_EVENT_SNAPSHOT = "snapshot" as const;
const SSE_EVENT_UPDATE = "update" as const;
/** SSE 心跳间隔（毫秒）：保活，避免代理断开空闲连接。 */
const SSE_HEARTBEAT_INTERVAL_MS = 15000 as const;

/**
 * Live 状态采集服务：以任务队列驱动「每 30 秒扫描一次书签目录、每秒处理一个书签」，
 * 抓取各直播站点的内嵌状态并通过 SSE 实时推送给前端表格。
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
  /** SSE 订阅者集合（每个连接对应一个 ServerResponse）。 */
  private readonly subscribers = new Set<ServerResponse>();

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

  /** 当前全部表格行数据（供首屏 SSR 使用）。 */
  getRows(): LiveBookmarkRow[] {
    return [...this.rows.values()];
  }

  /**
   * 处理一次 SSE 连接：写入响应头、发送首屏快照，并在连接关闭时清理。
   * @param _req 入站请求（当前未使用，预留扩展）
   * @param res  服务端响应对象
   */
  handleSse(_req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    // 客户端断线后 3 秒自动重连
    res.write("retry: 3000\n\n");
    // 立即推送当前快照
    res.write(this.toSseMessage(SSE_EVENT_SNAPSHOT, { rows: this.getRows() }));
    this.subscribers.add(res);

    // 心跳保活
    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, SSE_HEARTBEAT_INTERVAL_MS);

    res.on("close", () => {
      clearInterval(heartbeat);
      this.subscribers.delete(res);
    });
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
    // 重建待处理队列（本轮需要逐个抓取的完整列表）
    this.pending = [...bookmarks];
    this.broadcast();
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
    this.broadcast();

    try {
      const html = await this.fetchLiveHtml(bm.url);
      const status = parseLiveRoomStatus(html);
      if (status) {
        row.state = "fetched";
        row.status = status;
        row.fetchedAt = Date.now();
        row.error = undefined;
        console.log(
          `[live] 书签处理成功：${row.name} | 在线=${status.isOnline} 屏蔽=${status.isBlocked} 状态="${status.offlineStatus}" 更新时间=${status.offlineStatusUpdatedAt}`,
        );
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
    this.broadcast();
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

  /** 向所有 SSE 订阅者广播当前快照。 */
  private broadcast(): void {
    if (this.subscribers.size === 0) {
      return;
    }
    const message = this.toSseMessage(SSE_EVENT_UPDATE, { rows: this.getRows() });
    for (const res of this.subscribers) {
      res.write(message);
    }
  }

  /** 将数据序列化为一条 SSE 消息（含事件名与 JSON 负载）。 */
  private toSseMessage(event: string, payload: LiveSnapshot): string {
    return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
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
