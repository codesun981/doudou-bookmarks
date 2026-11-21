export type GlassIntensity = 'low' | 'medium' | 'high';
export type BookmarkSyncMode = 'import' | 'follow';
export type SearchEngineId = 'bing' | 'google' | 'baidu' | 'duckduckgo';
// 壁纸 id：内置预设，或 'url:<图片直链>'（图床壁纸，fork 扩展）
export type WallpaperId = 'sunny' | 'forest' | 'avenue' | 'braid' | 'bokeh' | 'hill' | (string & {});
export type Appearance = 'light';
export type BookmarkColumns = 1 | 2 | 3 | 4 | 5;
export type BookmarkViewMode = 'icons' | 'cards';
/** 多链接书签的卡片点击行为：choose=弹窗选入口，primary=直达主链接。 */
export type MultiLinkClick = 'choose' | 'primary';
/** 布局模式：desktops=多桌面切换，single=一页全览分区。 */
export type LayoutMode = 'desktops' | 'single';

export interface AppSettings {
  schemaVersion: number;
  appearance: Appearance;
  glassIntensity: GlassIntensity;
  reducedMotion: boolean;
  bookmarkSyncMode: BookmarkSyncMode;
  dockAutoHide: boolean;
  searchEngine: SearchEngineId;
  defaultWallpaper: WallpaperId;
  dockPinnedBookmarkIds: string[];
  bookmarkColumns: BookmarkColumns;
  bookmarkViewMode: BookmarkViewMode;
  showDesktopDots: boolean;
  onboarded: boolean;
  multiLinkClick: MultiLinkClick;
  multiLinkQuickButton: boolean;
  preloadWallpapers: boolean;
  layoutMode: LayoutMode;
  /** 一页白名单：已知的分类名（用于识别新分类）。 */
  singleKnownCategories: string[];
  /** 一页白名单：被排除的分类（新分类首次出现自动加入）。 */
  singleExcludedCategories: string[];
}
