/** 直播间状态：从站点页面内嵌 JSON 中解析得到，作为表格展示字段。 */
export interface LiveRoomStatus {
  /** 离线文案，如「每天下午16:00开播」 */
  offlineStatus: string;
  /** 状态更新时间（ISO 8601 字符串，如 2026-10-13T17:54:16Z） */
  offlineStatusUpdatedAt: string;
  /** 是否正在直播 */
  isOnline: boolean;
  /** 是否被屏蔽 */
  isBlocked: boolean;
  /** 头像原图地址 */
  avatarUrl: string;
  /** 头像缩略图地址（展示优先使用） */
  avatarUrlThumb: string;
  /** 头像原图（无后缀）地址 */
  avatarUrlOriginal: string;
}

/** 单条书签抓取状态。 */
export type BookmarkFetchState = "pending" | "fetched" | "notfound" | "error";

/** 表格中的单行数据：书签基础信息 + 抓取状态与解析出的直播间状态。 */
export interface LiveBookmarkRow {
  /** 书签 id */
  id: string;
  /** 书签标题 */
  name: string;
  /** 书签地址 */
  url: string;
  /** 抓取状态 */
  state: BookmarkFetchState;
  /** 解析出的直播间状态；state 为 fetched 时存在 */
  status?: LiveRoomStatus;
  /** 错误信息（state 为 error / notfound 时） */
  error?: string;
  /** 最近一次成功抓取的时间戳（Date.now()） */
  fetchedAt?: number;
}

/** SSE 推送的快照结构：包含全部书签行及其最新抓取结果。 */
export interface LiveSnapshot {
  /** 全部书签行 */
  rows: LiveBookmarkRow[];
}
