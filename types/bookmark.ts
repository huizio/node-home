/** 书签节点类型：folder 表示目录，url 表示具体书签。 */
export type BookmarkNodeType = "folder" | "url";

/** Edge 书签文件中的单个节点，既可能是目录（folder）也可能是书签（url）。 */
export interface BookmarkNode {
  /** 节点唯一 id */
  id: string;
  /** 显示名称：目录即目录名，书签即网页标题 */
  name: string;
  /** 节点类型：folder=目录，url=书签 */
  type: BookmarkNodeType;
  /** 书签地址；仅当 type 为 url 时存在 */
  url?: string;
  /** 子节点列表；仅当 type 为 folder 时可能存在 */
  children?: BookmarkNode[];
  /** 节点 guid，Edge 内部标识 */
  guid?: string;
  /** 新增时间（微秒时间戳字符串） */
  dateAdded?: string;
  /** 最近修改时间（微秒时间戳字符串） */
  dateModified?: string;
}

/** Edge 书签文件整体结构（即 Bookmarks JSON 解析后的对象）。 */
export interface BookmarkFile {
  /** 校验和，Edge 用于快速判断是否需要重新写入 */
  checksum: string;
  /** 根节点集合：通常包含 bookmark_bar、other、synced 三个目录 */
  roots: Record<string, BookmarkNode>;
  /** 文件格式版本 */
  version: number;
}

/** 对外暴露的精简书签结构，仅包含定位所需的必要字段。 */
export interface Bookmark {
  /** 节点 id */
  id: string;
  /** 书签标题 */
  name: string;
  /** 书签地址 */
  url: string;
}
