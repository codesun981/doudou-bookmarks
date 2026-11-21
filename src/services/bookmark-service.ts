import { buildBookmarkCache } from '../features/bookmarks/sync';
import { indexBookmarks, listFolderCandidates } from '../features/bookmarks/tree';
import type { BookmarkCacheEntry, BookmarkMeta, BookmarkNode, FolderCandidate } from '../types/bookmark';
import { invalidateBookmarkTreeCache, readBookmarkTree } from './browser-api';
import { isServerMode } from './server-mode';

export interface BookmarkSnapshot {
  tree: BookmarkNode[];
  index: Map<string, BookmarkMeta>;
  cache: Record<string, BookmarkCacheEntry>;
  folders: FolderCandidate[];
}

export async function loadBookmarkSnapshot(): Promise<BookmarkSnapshot> {
  // 云端模式：treeMemo 会让会话内刷新永远拿到旧树（编辑保存后不刷新的根因），加载前先失效。
  if (isServerMode()) invalidateBookmarkTreeCache();
  const tree = await readBookmarkTree();
  return {
    tree,
    index: indexBookmarks(tree),
    cache: buildBookmarkCache(tree),
    folders: listFolderCandidates(tree),
  };
}
