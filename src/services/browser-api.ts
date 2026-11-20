import type { BookmarkNode } from '../types/bookmark';
import { normalizeChromeTree } from '../features/bookmarks/tree';
import { DEMO_BOOKMARK_TREE } from './demo-data';
import { localFavicon } from '../utils/site-icons';
import { faviconRefreshEpoch, hasRefreshedFavicon } from './favicon-refresh';
import { isServerMode } from './server-mode';

export function isExtensionEnvironment(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.id === 'string' &&
    typeof chrome.bookmarks !== 'undefined' &&
    typeof chrome.storage !== 'undefined'
  );
}

export function hasBookmarkAccess(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.id === 'string' &&
    typeof chrome.bookmarks !== 'undefined'
  );
}

function cloneDemoTree(): BookmarkNode[] {
  return structuredClone(DEMO_BOOKMARK_TREE);
}

function isExtensionPage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.runtime !== 'undefined' &&
    typeof chrome.runtime.id === 'string'
  );
}

export async function readBookmarkTree(): Promise<BookmarkNode[]> {
  if (isServerMode()) {
    // 豆豆书签（fork）：书签树来自 Worker 的 /api/tree（D1）。
    const res = await fetch('/api/tree');
    if (!res.ok) throw new Error('TREE_LOAD_FAILED');
    const data = (await res.json()) as { tree: BookmarkNode[] };
    return data.tree;
  }
  if (hasBookmarkAccess()) {
    const tree = await chrome.bookmarks.getTree();
    return normalizeChromeTree(tree);
  }
  if (isExtensionPage()) {
    throw new Error('BOOKMARK_PERMISSION_REQUIRED');
  }
  return cloneDemoTree();
}

export interface BookmarkChangeListener {
  (): void;
}

export function subscribeBookmarkChanges(listener: BookmarkChangeListener): () => void {
  if (!hasBookmarkAccess()) return () => undefined;
  const bookmarks = chrome.bookmarks;
  const created = () => listener();
  const removed = () => listener();
  const changed = () => listener();
  const moved = () => listener();
  const reordered = () => listener();
  const importEnded = () => listener();

  bookmarks.onCreated.addListener(created);
  bookmarks.onRemoved.addListener(removed);
  bookmarks.onChanged.addListener(changed);
  bookmarks.onMoved.addListener(moved);
  bookmarks.onChildrenReordered.addListener(reordered);
  bookmarks.onImportEnded.addListener(importEnded);

  return () => {
    bookmarks.onCreated.removeListener(created);
    bookmarks.onRemoved.removeListener(removed);
    bookmarks.onChanged.removeListener(changed);
    bookmarks.onMoved.removeListener(moved);
    bookmarks.onChildrenReordered.removeListener(reordered);
    bookmarks.onImportEnded.removeListener(importEnded);
  };
}

export function openUrl(url: string, newTab = false): void {
  if (newTab) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  window.location.assign(url);
}

export interface FaviconCandidate {
  src: string;
  /** Bundled asset; failures are deployment problems, not a missing site icon. */
  local: boolean;
  /** Compare against the browser's default favicon and reject blank pixels. */
  inspect: boolean;
  /** Cache-busting token on retries so a cached miss can be replaced. */
  retryable: boolean;
}

const FAVICON_SESSION = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function faviconCacheUrl(pageUrl: string, size: number, epoch: number): string {
  return chrome.runtime.getURL(
    `/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=${size}&fallbackToHost=1&_gd=${epoch}-${FAVICON_SESSION}`,
  );
}

/**
 * Ordered icon sources for a bookmark. Local bundle first, then the browser's
 * favicon database with host-level fallback, then (only after an explicit
 * bookmark re-import) the site itself and a public favicon service.
 */
export function faviconCandidates(
  url: string | null | undefined,
  size = 64,
): FaviconCandidate[] {
  if (!url) return [];
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [];
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return [];

  const candidates: FaviconCandidate[] = [];
  const local = localFavicon(parsed.hostname);
  if (local) {
    candidates.push({ src: local, local: true, inspect: false, retryable: false });
  }

  if (isExtensionPage()) {
    const epoch = faviconRefreshEpoch();
    const pageUrl = `${parsed.origin}${parsed.pathname}${parsed.search}`;
    candidates.push({
      src: faviconCacheUrl(pageUrl, size, epoch),
      local: false,
      inspect: true,
      retryable: true,
    });
    const originUrl = `${parsed.origin}/`;
    if (originUrl !== pageUrl) {
      candidates.push({
        src: faviconCacheUrl(originUrl, size, epoch),
        local: false,
        inspect: true,
        retryable: true,
      });
    }
    if (hasRefreshedFavicon(parsed.origin)) {
      if (parsed.protocol === 'https:') {
        candidates.push({
          src: `${parsed.origin}/favicon.ico?glassdesk=${epoch}`,
          local: false,
          inspect: false,
          retryable: true,
        });
      }
      candidates.push({
        src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=${size}&glassdesk=${epoch}`,
        local: false,
        inspect: false,
        retryable: true,
      });
    }
  } else if (isServerMode()) {
    // 豆豆书签（fork）：图标由 Worker 代理抓取（显式 logo→apple-touch-icon→favicon→首字色块），
    // 不依赖 Google favicon 服务（国内网络常不可达，且自建站它多半只回通用地球仪）。
    candidates.push({
      src: `/api/icon?url=${encodeURIComponent(url)}`,
      local: false,
      inspect: false,
      retryable: false,
    });
    candidates.push({
      src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=${size}`,
      local: false,
      inspect: false,
      retryable: true,
    });
  } else {
    candidates.push({
      src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=${size}`,
      local: false,
      inspect: false,
      retryable: true,
    });
  }

  return candidates;
}

export function faviconUrl(url: string | null | undefined, size = 64): string | null {
  return faviconCandidates(url, size)[0]?.src ?? null;
}
