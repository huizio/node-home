import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOOKMARK_NODE_TYPE, EDGE_BOOKMARKS_RELATIVE_PATH } from "@/constants";
import type { Bookmark, BookmarkFile, BookmarkNode } from "@/types";

/** Edge 浏览器书签读取工具：支持全量读取与按目录名检索书签。 */
export class EdgeBookmarkReader {
  private readonly bookmarksPath: string;

  /**
   * 创建读取器。
   * @param bookmarksPath 可选的 Bookmarks 文件路径；不传时使用当前系统默认 Edge 路径。
   */
  constructor(bookmarksPath?: string) {
    this.bookmarksPath = bookmarksPath ?? this.getDefaultPath();
  }

  /** 根据 LOCALAPPDATA 推算 Windows 下 Edge 默认书签文件路径。 */
  private getDefaultPath(): string {
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error(
        "无法定位 Edge 书签文件：未找到 LOCALAPPDATA 环境变量，请通过构造函数显式传入 bookmarksPath。",
      );
    }
    return path.join(localAppData, EDGE_BOOKMARKS_RELATIVE_PATH);
  }

  /** 全量读取书签文件，返回完整的树形结构（roots 下的各根目录及全部层级 children）。 */
  async readAll(): Promise<BookmarkFile> {
    const raw = await readFile(this.bookmarksPath, "utf-8");
    return JSON.parse(raw) as BookmarkFile;
  }

  /**
   * 按目录名递归收集其下所有书签（支持多级子目录）。
   * @param folderName 目标目录名称；若存在多个同名目录，则全部命中
   * @returns 命中的全部书签（含子目录中的书签）
   */
  async getBookmarksByFolderName(folderName: string): Promise<Bookmark[]> {
    const file = await this.readAll();
    const folders = this.findFolders(file.roots, folderName);
    const result: Bookmark[] = [];
    for (const folder of folders) {
      this.collectUrlsDeep(folder, result);
    }
    return result;
  }

  /**
   * 按目录名获取其直接子级中的书签（仅一级，不含子目录）。
   * @param folderName 目标目录名称；若存在多个同名目录，则全部命中
   * @returns 该目录直接下属的书签（目录本身不计入，子目录内的书签也不计入）
   */
  async getDirectBookmarksByFolderName(folderName: string): Promise<Bookmark[]> {
    const file = await this.readAll();
    const folders = this.findFolders(file.roots, folderName);
    const result: Bookmark[] = [];
    for (const folder of folders) {
      for (const child of folder.children ?? []) {
        if (child.type === BOOKMARK_NODE_TYPE.URL && child.url) {
          result.push({ id: child.id, name: child.name, url: child.url });
        }
      }
    }
    return result;
  }

  /** 在所有根节点中按名称递归查找目录节点（同名目录会全部返回）。 */
  private findFolders(root: Record<string, BookmarkNode>, folderName: string): BookmarkNode[] {
    const matches: BookmarkNode[] = [];
    const stack: BookmarkNode[] = Object.values(root);
    while (stack.length > 0) {
      const node = stack.pop() as BookmarkNode;
      if (node.type !== BOOKMARK_NODE_TYPE.FOLDER) {
        continue;
      }
      if (node.name === folderName) {
        matches.push(node);
      }
      if (node.children) {
        stack.push(...node.children);
      }
    }
    return matches;
  }

  /** 递归收集某个目录节点下所有层级的书签（url 类型），结果追加到 result。 */
  private collectUrlsDeep(folder: BookmarkNode, result: Bookmark[]): void {
    for (const child of folder.children ?? []) {
      if (child.type === BOOKMARK_NODE_TYPE.URL && child.url) {
        result.push({ id: child.id, name: child.name, url: child.url });
      } else if (child.type === BOOKMARK_NODE_TYPE.FOLDER) {
        this.collectUrlsDeep(child, result);
      }
    }
  }
}
