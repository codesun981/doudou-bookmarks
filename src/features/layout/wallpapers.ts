import type { WallpaperId } from '../../types/settings';

export interface WallpaperPreset {
  id: WallpaperId;
  name: string;
  description: string;
  background: string;
  thumbnail: string;
}

interface WallpaperSource {
  id: WallpaperId;
  name: string;
  description: string;
  file: string;
}

const SOURCES: WallpaperSource[] = [
  {
    id: 'sunny',
    name: '晴空',
    description: '蓝天树影 · 内置照片',
    file: 'sunny.webp',
  },
  {
    id: 'forest',
    name: '林荫',
    description: '林间小路 · 内置照片',
    file: 'forest.webp',
  },
  {
    id: 'avenue',
    name: '梧桐',
    description: '林荫大道 · 内置照片',
    file: 'avenue.webp',
  },
  {
    id: 'braid',
    name: '青丝',
    description: '绿荫近景 · 内置照片',
    file: 'braid.webp',
  },
  {
    id: 'bokeh',
    name: '光影',
    description: '光斑长发 · 内置照片',
    file: 'bokeh.webp',
  },
  {
    id: 'hill',
    name: '草坡',
    description: '蓝天草坡 · 内置照片',
    file: 'hill.webp',
  },
];

const BASE_WALLPAPERS: WallpaperPreset[] = SOURCES.map((source) => ({
  id: source.id,
  name: source.name,
  description: source.description,
  background: `url("/wallpapers/${source.file}") center / cover no-repeat`,
  thumbnail: `url("/wallpapers/thumbs/${source.file}") center / cover no-repeat`,
}));

export const WALLPAPERS: WallpaperPreset[] = BASE_WALLPAPERS;

/** 壁纸的原始图片 URL（预加载用）：预设 → /wallpapers/<file>，url: → 直链本身。 */
export function wallpaperImageUrl(id: WallpaperId | undefined): string | null {
  if (typeof id === 'string' && id.startsWith('url:')) {
    const url = id.slice(4);
    return /^https:\/\//.test(url) ? url : null;
  }
  const source = SOURCES.find((s) => s.id === id) ?? SOURCES[0]!;
  return `/wallpapers/${source.file}`;
}

export function getWallpaper(id: WallpaperId | undefined): WallpaperPreset {
  // 图床壁纸（fork）：id 形如 'url:https://cfimg.pages.dev/file/xxx.jpg'，直接合成预设。
  if (typeof id === 'string' && id.startsWith('url:')) {
    const url = id.slice(4);
    if (/^https:\/\//.test(url)) {
      const bg = `url("${url}") center / cover no-repeat`;
      return { id, name: '图床壁纸', description: '来自图床的图片链接', background: bg, thumbnail: bg };
    }
  }
  return WALLPAPERS.find((wallpaper) => wallpaper.id === id) ?? WALLPAPERS[0]!;
}
