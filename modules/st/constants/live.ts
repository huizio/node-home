/** 直播书签所在目录名：读取「live」目录下的直接书签（不含子目录）。 */
/**
 * Windows Toast 通知的源标识（显示在通知底部，亦用于系统对该通知归类）。
 * 桌面应用一般随意填写一个稳定字符串即可，无需真实应用清单。
 */
export const LIVE_NOTIFY_APP_ID = "node-home" as const;

/** 直播书签所在目录名：读取「live」目录下的直接书签（不含子目录）。 */
export const LIVE_FOLDER_NAME = "live" as const;

/** 主调度间隔（毫秒）：每 30 秒重新发现一次 live 目录书签并刷新待处理队列。 */
export const LIVE_SCRAPE_INTERVAL_MS = 30000 as const;

/** 单个书签处理间隔（毫秒）：任务队列每秒处理一个书签。 */
export const LIVE_BOOKMARK_PROCESS_INTERVAL_MS = 2000 as const;

/**
 * 请求直播站点时携带的请求头（模拟浏览器，避免被站点拦截）。
 * 注意：accept-encoding 去掉了 zstd，因为 Node 内置 fetch（undici）暂不支持
 * zstd 解码；保留其支持的 gzip / deflate / br，压缩仍由 fetch 自动解压。
 */
export const LIVE_REQUEST_HEADERS = {
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
  "accept-encoding": "gzip, deflate, br",
  "accept-language": "zh-CN,zh;q=0.9",
  "cache-control": "max-age=0",
  priority: "u=0, i",
  "sec-ch-ua": '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36",
} as const;

/**
 * 请求时携带的 Cookie。当前为空，请按需填入站点登录态 Cookie
 *（抓某些站点时缺少登录态可能返回非预期内容）。
 */
export const LIVE_REQUEST_COOKIE = "" as const;

/**
 * 请求所用的代理地址。浏览器通过该本地代理访问直播站点（远程地址 127.0.0.1:10808），
 * 而 Node 内置 fetch 默认不走系统 / 浏览器代理，会导致拿到被拦截的页面、从而找不到状态字段。
 * 故需显式配置同源代理。可通过环境变量 LIVE_PROXY_URL 覆盖；留空则不使用代理直连。
 */
export const LIVE_PROXY_URL = (process.env.LIVE_PROXY_URL ?? "http://127.0.0.1:10808") as string;

/** WebSocket 通信路径：前端经此路径升级到 WebSocket，接收快照 / 上报通知开关。 */
export const LIVE_WS_PATH = "/ws" as const;

/** 逐行通知开关在 localStorage 中的键名（值为 id -> 是否启用的 JSON 映射）。 */
export const LIVE_NOTIFY_STORAGE_KEY = "liveNotifyMap" as const;
