import type { WallpaperId } from '../../types/settings';
import { isServerMode } from '../../services/server-mode';

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
    id: 'dusk',
    name: '深海蓝',
    description: '索诺玛式蓝色光刃',
    file: 'deep-blue.webp',
  },
  {
    id: 'sunrise',
    name: '流光金',
    description: '香槟金属与丝绸',
    file: 'gold-flow.webp',
  },
  {
    id: 'mint',
    name: '青雾',
    description: '冷青色光刃',
    file: 'teal-flow.webp',
  },
  {
    id: 'dune',
    name: '暮紫',
    description: '靛蓝与紫外光',
    file: 'violet-flow.webp',
  },
  {
    id: 'paper',
    name: '石墨',
    description: '低调的黑色金属',
    file: 'graphite-flow.webp',
  },
  {
    id: 'forest',
    name: '雾林',
    description: '雾气松林 · 照片',
    file: 'forest-fog.webp',
  },
  {
    id: 'lake',
    name: '晨湖',
    description: '雪山晨湖 · 照片',
    file: 'alpine-lake.webp',
  },
  {
    id: 'coast',
    name: '暮海',
    description: '黄昏海岸 · 照片',
    file: 'coast-dusk.webp',
  },
];

const BASE_WALLPAPERS: WallpaperPreset[] = SOURCES.map((source) => ({
  id: source.id,
  name: source.name,
  description: source.description,
  background: `url("/wallpapers/${source.file}") center / cover no-repeat`,
  thumbnail: `url("/wallpapers/thumbs/${source.file}") center / cover no-repeat`,
}));

// 豆豆书签（fork）：用户自己的照片，由 Worker 从 KV 以 /wallpaper.jpg 提供。
const DOUDOU_WALLPAPER: WallpaperPreset = {
  id: 'doudou',
  name: '我的照片',
  description: '林荫道 · 云端壁纸',
  background: 'url("/wallpaper.jpg") center / cover no-repeat',
  thumbnail: 'url("/wallpaper.jpg") center / cover no-repeat',
};

export const WALLPAPERS: WallpaperPreset[] = isServerMode()
  ? [DOUDOU_WALLPAPER, ...BASE_WALLPAPERS]
  : BASE_WALLPAPERS;

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
