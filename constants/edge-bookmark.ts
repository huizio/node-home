/** Edge 书签文件相对 LOCALAPPDATA 的路径（Windows 默认路径，不含盘符与用户目录）。 */
export const EDGE_BOOKMARKS_RELATIVE_PATH = "Microsoft/Edge/User Data/Default/Bookmarks" as const;

/** 书签节点类型枚举，对应 Edge Bookmarks JSON 中节点的 type 字段取值。 */
export const BOOKMARK_NODE_TYPE = {
  /** 目录 */
  FOLDER: "folder",
  /** 书签（网页） */
  URL: "url",
} as const;

/** Edge 书签文件 roots 下的三个根目录 key，用于按根遍历书签树。 */
export const EDGE_BOOKMARK_ROOT_KEYS = {
  /** 书签栏 */
  BOOKMARK_BAR: "bookmark_bar",
  /** 其他书签 */
  OTHER: "other",
  /** 已同步书签 */
  SYNCED: "synced",
} as const;
