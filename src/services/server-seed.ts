import type { BookmarkNode } from '../types/bookmark';
import type { Desktop } from '../types/desktop';

// 豆豆书签（fork）：首次打开（云端布局为空）时，按书签树的顶层文件夹
// 一一对应生成桌面，保证四个分类开箱即在，不走演示种子也不进引导页。
export function createServerSeed(tree: BookmarkNode[], now: number): { desktops: Desktop[] } {
  const root = tree[0];
  const folders = (root?.children ?? []).filter((node) => Array.isArray(node.children));
  const desktops: Desktop[] = folders.map((folder, index) => ({
    id: `desktop-${folder.id}`,
    name: folder.title,
    sourceFolderId: folder.id,
    bookmarkIds: (folder.children ?? []).filter((child) => typeof child.url === 'string').map((child) => child.id),
    createdAt: now - (folders.length - index) * 1000,
    updatedAt: now,
  }));
  return { desktops };
}
