/** 多链接书签的副链接（主链接仍是书签自身的 url）。 */
export interface BookmarkLink {
  label: string;
  url: string;
}

export interface BookmarkNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  desc?: string;
  tag?: string;
  links?: BookmarkLink[];
  children?: BookmarkNode[];
  dateAdded?: number;
}

export type BookmarkItemKind = 'bookmark' | 'folder';

/** A bookmark or a nested folder rendered as one desktop item. */
export interface BookmarkItemView {
  id: string;
  kind: BookmarkItemKind;
  title: string;
  /** Empty for folders. */
  url: string;
  path: string[];
  missing: boolean;
  /** Number of bookmarks inside a folder. Folders only. */
  count?: number;
  /** 站点备注（服务端模式来自 D1 sites.desc）。 */
  desc?: string;
  tag?: string;
  links?: BookmarkLink[];
}

export interface BookmarkMeta {
  id: string;
  title: string;
  url: string;
  parentId: string;
  path: string[];
  desc?: string;
  tag?: string;
  links?: BookmarkLink[];
  dateAdded?: number;
}

export interface BookmarkLayout {
  bookmarkId: string;
  desktopId: string;
  order: number;
  x?: number;
  y?: number;
}

export interface BookmarkCacheEntry {
  id: string;
  title: string;
  url: string;
  parentId: string;
  path: string[];
  desc?: string;
  tag?: string;
  links?: BookmarkLink[];
  cachedAt: number;
}

export interface FolderCandidate {
  id: string;
  title: string;
  path: string[];
  depth: number;
  count: number;
}
