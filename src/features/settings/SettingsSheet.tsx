import { useEffect, useRef, useState } from 'react';
import {
  ArrowClockwise,
  ArrowDown,
  ArrowUp,
  CircleNotch,
  DownloadSimple,
  Globe,
  HardDrive,
  Info,
  Keyboard,
  MagnifyingGlass,
  Monitor,
  Plus,
  Sparkle,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import type { Desktop } from '../../types/desktop';
import type { BookmarkColumns, LayoutMode } from '../../types/settings';
import type { SettingsSection } from '../../stores/ui-store';
import { getWallpaper, WALLPAPERS } from '../../features/layout/wallpapers';
import { countBookmarksInItems } from '../../features/bookmarks/folders';
import { SEARCH_ENGINES } from '../../features/search/search';
import { BOOKMARK_COLUMNS } from '../../utils/defaults';
import { downloadBackup, importBackupFile } from '../../features/settings/backup';
import { storageService } from '../../services/storage-service';
import { uploadToImgbed } from '../../services/imgbed';
import { isServerMode } from '../../services/server-mode';
import { ServerBookmarksAdmin } from './ServerBookmarksAdmin';
import {
  addBlankDesktop,
  addDesktopFromFolder,
  cleanupMissingBookmarks,
  deleteDesktop,
  reimportBookmarks,
  renameDesktop,
  reorderDesktop,
  setActiveDesktop,
  setDesktopWallpaper,
  useWorkspace,
} from '../../stores/desktop-store';
import { patchSettings, useSettings } from '../../stores/settings-store';
import {
  setSettingsOpen,
  useUiState,
  pushToast,
} from '../../stores/ui-store';
import { APP_VERSION } from '../../utils/constants';
import { modifierLabel } from '../../utils/events';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Segmented, SettingRow, Switch } from '../../components/ui/Controls';

const SECTIONS: Array<{ id: SettingsSection; label: string; icon: typeof Monitor }> = [
  { id: 'appearance', label: '外观', icon: Sparkle },
  { id: 'desktops', label: '桌面与书签', icon: Monitor },
  { id: 'search', label: '搜索与快捷键', icon: MagnifyingGlass },
  { id: 'data', label: '数据与备份', icon: HardDrive },
  ...(isServerMode()
    ? [
        { id: 'server' as const, label: '书签管理（云端）', icon: HardDrive },
        { id: 'imgbed' as const, label: '图床上传', icon: UploadSimple },
      ]
    : []),
];

const SECTION_COPY: Record<SettingsSection, { title: string; description: string }> = {
  appearance: { title: '外观', description: '壁纸、书签列数、玻璃质感和细微的动效偏好。' },
  desktops: { title: '桌面与书签', description: '管理桌面的名称、顺序与壁纸。' },
  server: { title: '书签管理（云端）', description: '书签与分类存在 Cloudflare 云端，在这里增删改，桌面会跟着同步。' },
  imgbed: { title: '图床上传', description: '把图片上传到你的图床（cfimg），拿到直链后可以直接设为桌面壁纸。' },
  search: { title: '搜索与快捷键', description: '默认搜索引擎与键盘操作。' },
  data: { title: '数据与备份', description: '导出、导入与重置界面数据。' },
  about: { title: '关于 GlassDesk', description: '版本、权限和实现边界。' },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function SettingsSheet() {
  const { settingsOpen, settingsSection } = useUiState();
  const workspace = useWorkspace();
  const [section, setSection] = useState<SettingsSection>(settingsSection === 'about' ? 'appearance' : settingsSection);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (settingsOpen) setSection(settingsSection === 'about' ? 'appearance' : settingsSection);
  }, [settingsOpen, settingsSection]);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [section]);

  const activeDesktop =
    workspace.desktops.find((desktop) => desktop.id === workspace.activeDesktopId) ?? null;

  return (
    <Modal
      open={settingsOpen}
      onClose={() => setSettingsOpen(false)}
      label="GlassDesk 设置"
      className="settings-sheet"
    >
      <div className="settings-windowbar">
        <div className="traffic-lights">
          <button
            type="button"
            className="traffic-light traffic-light--close"
            aria-label="关闭设置"
            onClick={() => setSettingsOpen(false)}
          />
          <span className="traffic-light traffic-light--min" aria-hidden="true" />
          <span className="traffic-light traffic-light--max" aria-hidden="true" />
        </div>
        <span className="settings-windowbar__title">设置</span>
      </div>
      <aside className="settings-nav">
        <div className="settings-brand">
          <img src="/icons/icon-48.png" alt="" width={30} height={30} />
          <div>
            <div className="settings-brand__name">豆豆书签</div>
            <div className="settings-brand__meta">v{APP_VERSION}</div>
          </div>
        </div>
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className="settings-nav__item"
              aria-current={section === item.id ? 'page' : undefined}
              onClick={() => setSection(item.id)}
            >
              <Icon size={15} />
              {item.label}
            </button>
          );
        })}
        <div className="settings-nav__footer">
          {isServerMode() ? (
            <>
              书签存放在云端。
              <br />
              界面布局云端同步。
            </>
          ) : (
            <>
              全部数据保存在本机。
              <br />
              浏览器书签不会被修改。
            </>
          )}
        </div>
      </aside>

      <div className="settings-main">
        <header className="settings-head">
          <div>
            <h2>{SECTION_COPY[section].title}</h2>
            <p>{SECTION_COPY[section].description}</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="关闭设置"
            onClick={() => setSettingsOpen(false)}
          >
            <X size={15} />
          </button>
        </header>
        <div className="settings-body scroll-area" ref={bodyRef}>
          {section === 'appearance' ? (
            <AppearanceSection activeDesktop={activeDesktop} />
          ) : null}
          {section === 'desktops' ? <DesktopsSection /> : null}
          {section === 'search' ? <SearchSection /> : null}
          {section === 'data' ? <DataSection /> : null}
          {section === 'server' ? <ServerBookmarksAdmin /> : null}
          {section === 'imgbed' ? <ImgbedUploadSection activeDesktop={activeDesktop} /> : null}
        </div>
      </div>
    </Modal>
  );
}

interface ImgbedFile { name: string; url: string }
function ImgbedGallery({ disabled, onPick }: { disabled: boolean; onPick: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'unconfigured' | 'error'>('idle');
  const [files, setFiles] = useState<ImgbedFile[]>([]);
  const [total, setTotal] = useState(0);
  const [returned, setReturned] = useState(0);

  async function load(start: number) {
    setState('loading');
    try {
      const res = await fetch(`/api/imgbed/list?start=${start}&count=60`);
      const body = (await res.json()) as { configured: boolean; files?: ImgbedFile[]; total?: number; returned?: number };
      if (!body.configured) { setState('unconfigured'); return; }
      if (!res.ok) { setState('error'); return; }
      setFiles((prev) => (start === 0 ? body.files ?? [] : [...prev, ...(body.files ?? [])]));
      setTotal(body.total ?? 0);
      setReturned(start + (body.returned ?? 0));
      setState('ready');
    } catch { setState('error'); }
  }

  return (
    <>
      <div style={{ padding: '2px 2px 6px' }}>
        <button
          type="button"
          className="chip"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            if (state === 'idle') void load(0);
          }}
        >
          从图床选图
        </button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} label="图床图库">
        <div style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <div className="modal__title">图床图库</div>
            <span style={{ fontSize: 12, opacity: 0.6 }}>
              {state === 'ready' && total > 0 ? `共 ${total} 张 · 点任意一张设为当前桌面壁纸` : ''}
            </span>
          </div>
          {state === 'loading' && files.length === 0 ? (
            <p className="modal__text">正在从图床拉取图片…</p>
          ) : null}
          {state === 'unconfigured' ? (
            <p className="modal__text">图床图库还没配置好（缺图床的 API Token），先用下面的贴链接方式，或让 COCO 帮你接上。</p>
          ) : null}
          {state === 'error' ? (
            <p className="modal__text">图床暂时连不上，稍后再试；也可以先用贴链接。</p>
          ) : null}
          {state === 'ready' && files.length === 0 ? (
            <p className="modal__text">图床里暂时没有图片，先去图床上传几张吧。</p>
          ) : null}
          {files.length > 0 ? (
            <div
              style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))',
                gap: 10, marginTop: 14, maxHeight: '52vh', overflowY: 'auto', paddingRight: 2,
              }}
            >
              {files.map((file) => (
                <button
                  key={file.name}
                  type="button"
                  title={file.name}
                  onClick={() => {
                    onPick(file.url);
                    setOpen(false);
                  }}
                  style={{
                    aspectRatio: '4 / 3', borderRadius: 12, padding: 0, overflow: 'hidden',
                    border: '1px solid rgb(127 140 180 / 25%)', background: 'rgb(127 140 180 / 12%)',
                    cursor: 'pointer',
                  }}
                >
                  <img
                    src={file.url}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
              ))}
            </div>
          ) : null}
          <div className="modal__actions">
            {returned < total ? (
              <button type="button" className="chip" disabled={state === 'loading'} onClick={() => void load(returned)}>
                {state === 'loading' ? '加载中…' : '加载更多'}
              </button>
            ) : null}
            <button type="button" className="chip" onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function ImgbedUploadSection({ activeDesktop }: { activeDesktop: Desktop | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [status, setStatus] = useState<'idle' | 'uploading' | 'done' | 'error' | 'unconfigured'>('idle');
  const [resultUrl, setResultUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(next: File | null | undefined) {
    if (!next) return;
    if (!next.type.startsWith('image/')) {
      pushToast('只能上传图片文件', 'error');
      return;
    }
    if (next.size > 25 * 1024 * 1024) {
      pushToast('图片超过 25MB，先压缩一下再传', 'error');
      return;
    }
    setFile(next);
    setStatus('idle');
    setResultUrl('');
    setCopied(false);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(next);
    });
  }

  async function upload() {
    if (!file) return;
    setStatus('uploading');
    const result = await uploadToImgbed(file);
    if (!result.ok) {
      setStatus(result.reason === 'unconfigured' ? 'unconfigured' : 'error');
      return;
    }
    setResultUrl(result.url);
    setStatus('done');
  }

  return (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-group__title">上传图片到图床</div>
        <div
          role="button"
          tabIndex={0}
          aria-label="选择或拖入图片"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            pick(event.dataTransfer.files?.[0]);
          }}
          onPaste={(event) => {
            const item = Array.from(event.clipboardData.files ?? [])[0];
            if (item) pick(item);
          }}
          style={{
            border: `1.5px dashed ${dragging ? 'rgb(90 120 220 / 70%)' : 'rgb(127 140 180 / 40%)'}`,
            borderRadius: 14,
            padding: preview ? 12 : '26px 12px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragging ? 'rgb(90 120 220 / 8%)' : 'rgb(127 140 180 / 6%)',
            outline: 'none',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
          {preview ? (
            <>
              <img
                src={preview}
                alt=""
                style={{ maxWidth: '100%', maxHeight: 220, borderRadius: 10, objectFit: 'contain' }}
              />
              <p style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
                {file?.name} · {file ? formatBytes(file.size) : ''}（点这里可换一张）
              </p>
            </>
          ) : (
            <>
              <UploadSimple size={22} style={{ opacity: 0.6 }} />
              <p style={{ fontSize: 13, marginTop: 6 }}>点击选择图片，或把图片拖进来 / 粘贴进来</p>
              <p style={{ fontSize: 11.5, opacity: 0.6, marginTop: 2 }}>支持常见图片格式，单张不超过 25MB</p>
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="chip"
            disabled={!file || status === 'uploading'}
            onClick={() => void upload()}
          >
            {status === 'uploading' ? '上传中…' : '上传到图床'}
          </button>
          {status === 'done' && resultUrl ? (
            <>
              <button
                type="button"
                className="chip"
                disabled={!activeDesktop}
                onClick={() => {
                  if (activeDesktop) {
                    setDesktopWallpaper(activeDesktop.id, `url:${resultUrl}`);
                    pushToast('已设为当前桌面壁纸', 'success');
                  }
                }}
              >
                设为当前桌面壁纸
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  void navigator.clipboard?.writeText(resultUrl).then(() => setCopied(true)).catch(() => undefined);
                }}
              >
                {copied ? '已复制' : '复制链接'}
              </button>
            </>
          ) : null}
        </div>
        {status === 'done' && resultUrl ? (
          <p style={{ fontSize: 12, wordBreak: 'break-all', opacity: 0.75 }}>
            上传成功：<a href={resultUrl} target="_blank" rel="noreferrer">{resultUrl}</a>
            <br />
            它也会出现在「外观 → 从图床选图」的图库里。
          </p>
        ) : null}
        {status === 'error' ? (
          <p style={{ fontSize: 12, opacity: 0.7 }}>上传失败，图床暂时连不上或拒绝了这张图，换一张或稍后再试。</p>
        ) : null}
        {status === 'unconfigured' ? (
          <p style={{ fontSize: 12, opacity: 0.7 }}>图床还没配置好（缺图床的 API Token），让 COCO 帮你接上后再来。</p>
        ) : null}
      </div>
    </div>
  );
}

function AppearanceSection({ activeDesktop }: { activeDesktop: Desktop | null }) {
  const settings = useSettings();
  const workspace = useWorkspace();
  const wallpaperId = activeDesktop?.wallpaper ?? settings.defaultWallpaper;
  const [imgbedUrl, setImgbedUrl] = useState(
    typeof wallpaperId === 'string' && wallpaperId.startsWith('url:') ? wallpaperId.slice(4) : '',
  );
  // 当前桌面壁纸变化时同步输入框：是图床壁纸就回显链接，选了预设就清空，避免残留误导
  useEffect(() => {
    setImgbedUrl(typeof wallpaperId === 'string' && wallpaperId.startsWith('url:') ? wallpaperId.slice(4) : '');
  }, [wallpaperId]);

  return (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-group__title">桌面壁纸</div>
        <div className="wallpaper-grid" role="group" aria-label="当前桌面壁纸">
          {WALLPAPERS.map((wallpaper) => (
            <button
              key={wallpaper.id}
              type="button"
              className="wallpaper-swatch"
              data-active={wallpaperId === wallpaper.id}
              style={{ background: wallpaper.thumbnail }}
              aria-label={wallpaper.name}
              title={`${wallpaper.name} · ${wallpaper.description}`}
              disabled={!activeDesktop}
              onClick={() => {
                if (activeDesktop) setDesktopWallpaper(activeDesktop.id, wallpaper.id);
              }}
            >
              <span className="wallpaper-swatch__label">{wallpaper.name}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn--glass btn--small"
            disabled={!activeDesktop}
            onClick={() => {
              workspace.desktops.forEach((d) => setDesktopWallpaper(d.id, wallpaperId));
              pushToast('当前壁纸已应用到所有桌面。', 'success');
            }}
          >
            把当前壁纸应用到所有桌面
          </button>
        </div>
        <div className="settings-row" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <div className="settings-row__text">
            <h3>图床壁纸</h3>
            <p>把图床（cfimg）里图片的直链贴进来，即可设为当前桌面壁纸。图片存在图床、本站只记链接。</p>
          </div>
        </div>
        <ImgbedGallery
          disabled={!activeDesktop}
          onPick={(url) => {
            setImgbedUrl(url);
            if (activeDesktop) setDesktopWallpaper(activeDesktop.id, `url:${url}`);
          }}
        />
        <div style={{ display: 'flex', gap: 8, padding: '0 2px 4px' }}>
          <input
            type="url"
            value={imgbedUrl}
            onChange={(event) => setImgbedUrl(event.target.value)}
            placeholder="https://cfimg.pages.dev/file/…"
            style={{
              flex: 1, minWidth: 0, height: 34, borderRadius: 9, padding: '0 11px', fontSize: 12.5,
              border: '1px solid rgb(127 140 180 / 30%)', background: 'rgb(127 140 180 / 10%)',
              color: 'inherit', outline: 'none',
            }}
          />
          <button
            type="button"
            className="chip"
            disabled={!activeDesktop || !/^https:\/\//.test(imgbedUrl.trim())}
            onClick={() => {
              if (activeDesktop) setDesktopWallpaper(activeDesktop.id, `url:${imgbedUrl.trim()}`);
            }}
          >
            用于当前桌面
          </button>
        </div>
        <div className="settings-row" style={{ borderBottom: 0 }}>
          <div className="settings-row__text">
            <h3>当前桌面</h3>
            <p>每个桌面可以有自己的壁纸。切换桌面后，这里会显示对应的设置。</p>
          </div>
          <span className="chip">{activeDesktop?.name ?? '没有桌面'}</span>
        </div>
        <SettingRow
          title="布局模式"
          description="一页全览：全部书签按分类分区分段排在同一页滚动浏览；多桌面：按分类分桌面、滚轮/点选切换。一页模式下小组件暂不显示。"
        >
          <Segmented
            label="布局模式"
            value={settings.layoutMode}
            options={[
              { value: 'single', label: '一页全览' },
              { value: 'desktops', label: '多桌面' },
            ]}
            onChange={(value) => patchSettings({ layoutMode: value as LayoutMode })}
          />
        </SettingRow>
        <SettingRow
          title="预加载全部壁纸"
          description="打开页面后趁空闲把每个桌面的壁纸提前下载到浏览器缓存，切换桌面时背景立即显示、不再现拉现等。流量敏感时可关。"
        >
          <Switch
            label="预加载全部壁纸"
            checked={settings.preloadWallpapers}
            onChange={(checked) => patchSettings({ preloadWallpapers: checked })}
          />
        </SettingRow>
      </div>

      <div className="settings-group">
        <div className="settings-group__title">桌面书签</div>
        <SettingRow
          title="每行显示数量（图标模式）"
          description="调整图标模式下书签区域的列数；卡片模式按宽度自动排版，此项不生效。窄屏会自动收敛到 3–4 列。"
        >
          <Segmented
            label="每行书签数量"
            value={String(settings.bookmarkColumns ?? 2)}
            options={BOOKMARK_COLUMNS.map((count) => ({
              value: String(count),
              label: String(count),
            }))}
            onChange={(value) =>
              patchSettings({ bookmarkColumns: Number(value) as BookmarkColumns })
            }
          />
        </SettingRow>
      </div>

      <div className="settings-group">
        <div className="settings-group__title">玻璃质感</div>
        <SettingRow
          title="玻璃强度"
          description="强度越高，backdrop blur 越明显，对性能的要求也越高。低强度会使用更实的底色。"
        >
          <Segmented
            label="玻璃强度"
            value={settings.glassIntensity}
            options={[
              { value: 'low', label: '低' },
              { value: 'medium', label: '中' },
              { value: 'high', label: '高' },
            ]}
            onChange={(value) => patchSettings({ glassIntensity: value })}
          />
        </SettingRow>
        <SettingRow
          title="减少动态效果"
          description="关闭桌面切换、胶囊展开和 Dock 的非必要动画。"
        >
          <Switch
            label="减少动态效果"
            checked={settings.reducedMotion}
            onChange={(checked) => patchSettings({ reducedMotion: checked })}
          />
        </SettingRow>
      </div>

      <div className="settings-group">
        <div className="settings-group__title">Dock 与导航</div>
        <SettingRow title="自动隐藏 Dock" description="只有把指针移到屏幕底部时才显示 Dock。">
          <Switch
            label="自动隐藏 Dock"
            checked={settings.dockAutoHide}
            onChange={(checked) => patchSettings({ dockAutoHide: checked })}
          />
        </SettingRow>
        <SettingRow title="显示桌面指示点" description="在 Dock 上方显示用于切换桌面的小圆点。">
          <Switch
            label="显示桌面指示点"
            checked={settings.showDesktopDots}
            onChange={(checked) => patchSettings({ showDesktopDots: checked })}
          />
        </SettingRow>
        <SettingRow
          title="切换桌面"
          description="在桌面空白处滚动滚轮，或使用触控板/触摸屏左右滑动。内容需要滚动时先滚动，到达边界后切换。"
        >
          <span className="chip">滚轮 / 滑动</span>
        </SettingRow>
      </div>
    </div>
  );
}

function DesktopsSection() {
  const settings = useSettings();
  const workspace = useWorkspace();
  const [deleteTarget, setDeleteTarget] = useState<Desktop | null>(null);
  const [folderToAdd, setFolderToAdd] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const orderedDesktops = workspace.desktopOrder
    .map((id) => workspace.desktops.find((desktop) => desktop.id === id))
    .filter((desktop): desktop is Desktop => Boolean(desktop));
  const mappedFolders = new Set(
    workspace.desktops
      .map((desktop) => desktop.sourceFolderId)
      .filter((id): id is string => Boolean(id)),
  );
  const availableFolders = workspace.bookmarkFolders.filter(
    (folder) => !mappedFolders.has(folder.id),
  );
  const permissionMissing = !workspace.hasBookmarkPermission && !workspace.isDemo;

  async function handleRefresh() {
    setRefreshing(true);
    await reimportBookmarks();
    setRefreshing(false);
  }

  async function handleAddFolder() {
    if (!folderToAdd) return;
    setAddingFolder(true);
    const id = await addDesktopFromFolder(folderToAdd);
    setAddingFolder(false);
    if (id) setFolderToAdd('');
  }

  return (
    <div className="settings-section">
      {permissionMissing && !isServerMode() ? (
        <div className="notice notice--warning">
          <WarningCircle size={15} weight="fill" />
          <span>
            当前没有书签权限。桌面和小组件仍可使用，但无法读取新的书签。请在浏览器扩展管理页确认权限。
          </span>
        </div>
      ) : null}

      {isServerMode() ? (
        <div className="settings-group">
          <div className="settings-group__title">多链接书签</div>
          <SettingRow
            title="卡片点击行为"
            description="带副链接的书签（一服务多入口）：「弹窗选择」点卡片先列出全部入口再选；「直达主链接」点卡片直接打开主链接。"
          >
            <Segmented
              label="多链接卡片点击行为"
              value={settings.multiLinkClick}
              options={[
                { value: 'choose', label: '弹窗选择' },
                { value: 'primary', label: '直达主链接' },
              ]}
              onChange={(value) => patchSettings({ multiLinkClick: value })}
            />
          </SettingRow>
          <SettingRow
            title="卡片快捷按钮"
            description="多链接卡片右上角的小按钮：弹窗模式下它直达主链接，直达模式下它打开入口选择弹窗。"
          >
            <Switch
              label="显示卡片快捷按钮"
              checked={settings.multiLinkQuickButton}
              onChange={(checked) => patchSettings({ multiLinkQuickButton: checked })}
            />
          </SettingRow>
        </div>
      ) : null}

      {!isServerMode() ? (
      <div className="settings-group">
        <div className="settings-group__title">书签同步</div>
        <SettingRow
          title="同步方式"
          description="「手动导入」只在你点击重新导入时更新。「跟随更新」会监听书签的新增、移动和删除。"
        >
          <Segmented
            label="书签同步方式"
            value={settings.bookmarkSyncMode}
            options={[
              { value: 'import', label: '手动导入' },
              { value: 'follow', label: '跟随更新' },
            ]}
            onChange={(value) => patchSettings({ bookmarkSyncMode: value })}
          />
        </SettingRow>
        <SettingRow
          title="重新导入书签"
          description="把新增书签加入对应桌面，同时刷新网站图标。优先使用本地缓存；未访问过的站点会向网站请求 favicon。不会修改浏览器书签。"
        >
          <button
            type="button"
            className="btn btn--glass btn--small"
            disabled={refreshing || permissionMissing}
            onClick={() => void handleRefresh()}
          >
            {refreshing ? <CircleNotch size={13} className="spin" /> : <ArrowClockwise size={13} />}
            重新导入
          </button>
        </SettingRow>
        <SettingRow
          title="清理失效书签"
          description="移除那些已从浏览器删除、但仍以占位形式留在桌面上的书签记录。"
        >
          <button
            type="button"
            className="btn btn--glass btn--small"
            onClick={() => cleanupMissingBookmarks()}
          >
            清理
          </button>
        </SettingRow>
      </div>
      ) : null}

      <div className="settings-group">
        <div className="settings-group__title">桌面列表</div>
        <div className="desktop-admin">
          {orderedDesktops.map((desktop, index) => (
            <DesktopAdminRow
              key={desktop.id}
              desktop={desktop}
              index={index}
              total={orderedDesktops.length}
              isActive={desktop.id === workspace.activeDesktopId}
              wallpaperName={getWallpaper(desktop.wallpaper ?? settings.defaultWallpaper).name}
              wallpaperBackground={getWallpaper(desktop.wallpaper ?? settings.defaultWallpaper).background}
              bookmarkCount={countBookmarksInItems(workspace.bookmarkTree, desktop.bookmarkIds)}
              sourceLabel={
                desktop.sourceFolderId
                  ? workspace.bookmarkFolders.find((folder) => folder.id === desktop.sourceFolderId)
                      ?.title ?? '书签文件夹'
                  : '自定义桌面'
              }
              onDelete={() => setDeleteTarget(desktop)}
            />
          ))}
        </div>
        <div className="desktop-add-row">
          <button
            type="button"
            className="btn btn--glass btn--small"
            onClick={() => {
              const id = addBlankDesktop();
              if (id) pushToast('已创建空白桌面。', 'success');
            }}
          >
            <Plus size={13} />
            空白桌面
          </button>
          {availableFolders.length > 0 && !isServerMode() ? (
            <>
              <select
                className="select"
                value={folderToAdd}
                aria-label="选择书签文件夹"
                onChange={(event) => setFolderToAdd(event.target.value)}
              >
                <option value="">选择书签文件夹…</option>
                {availableFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.path.filter((part) => part && part !== '书签').join(' / ') || folder.title}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn--primary btn--small"
                disabled={!folderToAdd || addingFolder}
                onClick={() => void handleAddFolder()}
              >
                {addingFolder ? <CircleNotch size={13} className="spin" /> : null}
                添加
              </button>
            </>
          ) : (
            <span className="faint" style={{ fontSize: 10.5 }}>
              所有书签文件夹都已经映射为桌面。
            </span>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={`删除桌面「${deleteTarget?.name ?? ''}」？`}
        body="只会删除这个桌面的布局、小组件和排列。浏览器里的书签不会被删除，之后可以重新导入。"
        confirmLabel="删除桌面"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteDesktop(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

interface DesktopAdminRowProps {
  desktop: Desktop;
  index: number;
  total: number;
  isActive: boolean;
  wallpaperName: string;
  wallpaperBackground: string;
  bookmarkCount: number;
  sourceLabel: string;
  onDelete: () => void;
}

function DesktopAdminRow({
  desktop,
  index,
  total,
  isActive,
  wallpaperName,
  wallpaperBackground,
  bookmarkCount,
  sourceLabel,
  onDelete,
}: DesktopAdminRowProps) {
  const [name, setName] = useState(desktop.name);

  useEffect(() => {
    setName(desktop.name);
  }, [desktop.name]);

  function commit() {
    const next = name.trim();
    if (!next) {
      setName(desktop.name);
      return;
    }
    if (next !== desktop.name) renameDesktop(desktop.id, next);
  }

  return (
    <div className="desktop-admin__row">
      <span
        className="desktop-admin__swatch"
        style={{ background: wallpaperBackground }}
        title={`壁纸：${wallpaperName}`}
        aria-hidden="true"
      />
      <div className="desktop-admin__name">
        <input
          value={name}
          aria-label={`重命名${desktop.name}`}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              setName(desktop.name);
              event.currentTarget.blur();
            }
          }}
        />
        <div className="desktop-admin__meta">
          <span>{bookmarkCount} 个书签</span>
          <span>·</span>
          <span>{sourceLabel}</span>
          {desktop.missingSource ? <span className="warn">来源已失效</span> : null}
          {isActive ? <span>当前</span> : null}
        </div>
      </div>
      <div className="desktop-admin__actions">
        <button
          type="button"
          className="icon-button"
          aria-label="上移桌面"
          disabled={index === 0}
          onClick={() => reorderDesktop(desktop.id, -1)}
        >
          <ArrowUp size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="下移桌面"
          disabled={index === total - 1}
          onClick={() => reorderDesktop(desktop.id, 1)}
        >
          <ArrowDown size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`切换到${desktop.name}`}
          onClick={() => {
            setActiveDesktop(desktop.id);
            setSettingsOpen(false);
          }}
        >
          <Monitor size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`删除${desktop.name}`}
          onClick={onDelete}
        >
          <Trash size={13} />
        </button>
      </div>
    </div>
  );
}

function SearchSection() {
  const settings = useSettings();
  return (
    <div className="settings-section">
      <div className="settings-group">
        <div className="settings-group__title">默认搜索引擎</div>
        <div className="engine-grid">
          {SEARCH_ENGINES.map((engine) => (
            <button
              key={engine.id}
              type="button"
              className="engine-option"
              data-active={settings.searchEngine === engine.id}
              onClick={() => patchSettings({ searchEngine: engine.id })}
            >
              <span className="engine-option__icon">
                <Globe size={15} />
              </span>
              <span className="engine-option__text">
                <span className="engine-option__name">{engine.name}</span>
                <span className="engine-option__hint">
                  {engine.hint || '搜索网页'}
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="settings-note">
          书签搜索完全在本地进行，不需要联网。只有把查询发送给搜索引擎时才需要网络。
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group__title">键盘快捷键</div>
        <div className="shortcut-list">
          <Shortcut keys={[modifierLabel(), 'K']} label="打开或关闭搜索" />
          <Shortcut keys={['[']} label="上一个桌面" />
          <Shortcut keys={[']']} label="下一个桌面" />
          <Shortcut keys={['Esc']} label="关闭当前浮层" />
          <Shortcut keys={[modifierLabel(), 'Enter']} label="在新标签页打开搜索结果" />
        </div>
        <p className="settings-note">
          <Keyboard size={12} style={{ display: 'inline', verticalAlign: -1, marginRight: 5 }} />
          在输入框内输入时，桌面切换快捷键不会触发。
        </p>
      </div>
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="shortcut-row">
      <span>{label}</span>
      <span>
        {keys.map((key) => (
          <span className="kbd" key={key}>
            {key}
          </span>
        ))}
      </span>
    </div>
  );
}

function DataSection() {
  const workspace = useWorkspace();
  const [bytes, setBytes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    void storageService.bytesInUse().then((value) => {
      if (!cancelled) setBytes(value);
    });
    return () => {
      cancelled = true;
    };
  }, [workspace.desktops, workspace.notes, workspace.countdowns]);

  async function refreshUsage() {
    setBytes(await storageService.bytesInUse());
  }

  async function handleExport() {
    setBusy(true);
    try {
      await downloadBackup();
      pushToast('备份已导出。', 'success');
    } catch (error) {
      console.error('[GlassDesk] Backup export failed', error);
      pushToast(error instanceof Error ? error.message : '导出失败。', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(file: File) {
    setBusy(true);
    try {
      const result = await importBackupFile(file);
      pushToast(`已导入 ${result.desktops} 个桌面，正在重新载入。`, 'success');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      console.error('[GlassDesk] Backup import failed', error);
      pushToast(error instanceof Error ? error.message : '导入失败。', 'error');
      setBusy(false);
    }
  }

  const percent = Math.min(100, (bytes / (10 * 1024 * 1024)) * 100);
  const dataParts = [
    `${workspace.desktops.length} 个桌面`,
    `${workspace.notes.length} 张便签`,
    `${workspace.countdowns.length} 个倒计时`,
  ];

  return (
    <div className="settings-section">
      {isServerMode() ? (
        <div className="notice">
          <Info size={15} />
          <span>
            云端模式：书签与分类存放在 Cloudflare。这里的导入备份与重置只影响界面布局和设置，不会删除云端书签。
          </span>
        </div>
      ) : null}
      {workspace.isDemo ? (
        <div className="notice">
          <Info size={15} weight="fill" />
          <span>当前正在显示开发环境的演示数据。安装为扩展后，这里会使用你真实的书签。</span>
        </div>
      ) : null}

      <div className="settings-group">
        <div className="settings-group__title">本地存储</div>
        <div className="settings-row">
          <div className="settings-row__text">
            <h3>已使用 {formatBytes(bytes)}</h3>
            <p>{dataParts.join(' · ')}。chrome.storage.local 的默认配额约为 10MB。</p>
            <div className="storage-meter" aria-hidden="true">
              <i style={{ width: `${percent}%` }} />
            </div>
          </div>
          <div className="settings-row__control">
            <button type="button" className="btn btn--glass btn--small" onClick={() => void refreshUsage()}>
              <ArrowClockwise size={13} />
              刷新
            </button>
          </div>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group__title">备份与恢复</div>
        <SettingRow
          title="导出备份"
          description="下载当前布局、便签、倒计时和设置。备份不包含浏览器书签本身。"
        >
          <button
            type="button"
            className="btn btn--glass btn--small"
            disabled={busy}
            onClick={() => void handleExport()}
          >
            <DownloadSimple size={13} />
            导出 JSON
          </button>
        </SettingRow>
        <SettingRow
          title="导入备份"
          description="导入会用备份覆盖当前布局。书签会尽量按网址重新匹配。"
        >
          <button
            type="button"
            className="btn btn--glass btn--small"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <UploadSimple size={13} />
            选择文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) setPendingImport(file);
            }}
          />
        </SettingRow>
        <SettingRow
          title="重置所有数据"
          description="删除 GlassDesk 保存的布局、便签、倒计时和设置。浏览器书签不受影响。"
        >
          <button
            type="button"
            className="btn btn--danger btn--small"
            onClick={() => setResetOpen(true)}
          >
            <Trash size={13} />
            重置
          </button>
        </SettingRow>
      </div>

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="导入这份备份？"
        body={`将使用「${pendingImport?.name ?? '备份文件'}」覆盖当前桌面布局、便签、倒计时和设置。导入后会重新载入新标签页。`}
        confirmLabel="导入并覆盖"
        danger
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          const file = pendingImport;
          setPendingImport(null);
          if (file) void handleImport(file);
        }}
      />
      <ConfirmDialog
        open={resetOpen}
        title="重置所有数据？"
        body="GlassDesk 的桌面布局、便签、倒计时和设置会被删除。浏览器书签不会被删除。此操作无法撤销。"
        confirmLabel="确认重置"
        danger
        onCancel={() => setResetOpen(false)}
        onConfirm={() => {
          setResetOpen(false);
          void storageService.resetAll().then(() => window.location.reload());
        }}
      />
    </div>
  );
}
