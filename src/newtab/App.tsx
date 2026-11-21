import { useEffect } from 'react';
import { bootstrapWorkspace } from '../features/desktops/bootstrap';
import { getWallpaper, wallpaperImageUrl } from '../features/layout/wallpapers';
import { useStore } from '../stores/create-store';
import {
  setActiveDesktop,
  useActiveDesktop,
  useWorkspaceStatus,
  workspaceStore,
} from '../stores/desktop-store';
import { useSettings } from '../stores/settings-store';
import { closeAllOverlays, setSearchOpen, uiStore } from '../stores/ui-store';
import { Wallpaper } from '../components/desktop/Wallpaper';
import { ErrorScreen } from '../components/desktop/ErrorScreen';
import { OnboardingScreen } from '../components/desktop/OnboardingScreen';
import { DesktopStage } from '../components/desktop/DesktopStage';
import { DesktopDots } from '../components/desktop/DesktopDots';
import { Dock } from '../components/dock/Dock';
import { StatusBar } from '../components/status-bar/StatusBar';
import { SettingsSheet } from '../features/settings/SettingsSheet';
import { ToastHost } from '../components/ui/ToastHost';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function App() {
  const status = useWorkspaceStatus();
  const desktop = useActiveDesktop();
  const settings = useSettings();
  const wallpaper = getWallpaper(desktop?.wallpaper ?? settings.defaultWallpaper);

  useEffect(() => {
    void bootstrapWorkspace();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.glass = settings.glassIntensity;
    root.dataset.motion = settings.reducedMotion ? 'reduced' : 'full';
    root.dataset.dockAutohide = settings.dockAutoHide ? 'true' : 'false';
  }, [settings.glassIntensity, settings.reducedMotion, settings.dockAutoHide]);

  useEffect(() => {
    if (status !== 'ready') closeAllOverlays();
  }, [status]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const ui = uiStore.getState();
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        if (ui.settingsOpen) return;
        event.preventDefault();
        setSearchOpen(!ui.searchOpen);
        return;
      }
      if (status !== 'ready' || ui.settingsOpen) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === '/' && !modifier && !event.altKey) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (event.key === '[' || event.key === ']') {
        const state = workspaceStore.getState();
        if (state.desktopOrder.length < 2) return;
        const currentIndex = state.desktopOrder.indexOf(state.activeDesktopId);
        if (currentIndex < 0) return;
        const offset = event.key === '[' ? -1 : 1;
        const nextIndex =
          (currentIndex + offset + state.desktopOrder.length) % state.desktopOrder.length;
        const nextId = state.desktopOrder[nextIndex];
        if (nextId) {
          event.preventDefault();
          setActiveDesktop(nextId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status]);

  // 壁纸预加载（2026-11-21）：就绪后趁空闲把所有桌面的壁纸图拉进浏览器缓存，
  // 切桌面时不再现下载现解码。关掉设置里的「预加载全部壁纸」即停。
  const desktops = useStore(workspaceStore, (state) => state.desktops);
  useEffect(() => {
    if (status !== 'ready' || !settings.preloadWallpapers) return;
    const ids = new Set<string>([settings.defaultWallpaper]);
    desktops.forEach((d) => {
      if (d.wallpaper) ids.add(d.wallpaper);
    });
    const urls = [...ids]
      .map((id) => wallpaperImageUrl(id))
      .filter((u): u is string => Boolean(u));
    if (urls.length === 0) return;
    const run = () => {
      urls.forEach((u) => {
        const img = new Image();
        img.src = u;
      });
    };
    const w = window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(run, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(run, 1200);
    return () => window.clearTimeout(timer);
  }, [status, settings.preloadWallpapers, settings.defaultWallpaper, desktops]);

  const ready = status === 'ready';

  return (
    <div className="app">
      <Wallpaper preset={wallpaper} />
      <div className="grain" aria-hidden="true" />

      {status === 'ready' ? (
        <>
          <StatusBar />
          <DesktopStage />
          <DesktopDots />
          <Dock />
          <SettingsSheet />
        </>
      ) : null}

      {status === 'onboarding' ? <OnboardingScreen /> : null}
      {status === 'error' ? <ErrorScreen /> : null}

      <ToastHost />

      {ready ? <div className="app__vignette" aria-hidden="true" /> : null}
    </div>
  );
}
