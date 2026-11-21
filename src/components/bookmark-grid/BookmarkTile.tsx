import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { ArrowSquareOut, Copy, List, WarningCircle } from '@phosphor-icons/react';
import { pushToast } from '../../stores/ui-store';
import type { BookmarkView } from '../../stores/desktop-store';
import { useFavicon } from '../../hooks/use-favicon';
import { useSettings } from '../../stores/settings-store';
import { openUrl } from '../../services/browser-api';
import { prettyUrl, siteHue, siteLetter } from '../../utils/url';

interface BookmarkTileProps {
  view: BookmarkView;
  variant?: 'tile' | 'card';
  desktopId?: string;
  pinned?: boolean;
  dragging?: boolean;
  dropPosition?: 'before' | 'after' | null;
  onDragStart?: (view: BookmarkView, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (view: BookmarkView, event: DragEvent<HTMLElement>) => void;
  onDrop?: (view: BookmarkView, event: DragEvent<HTMLElement>) => void;
  onContextMenu?: (
    view: BookmarkView,
    event: MouseEvent<HTMLElement> | { x: number; y: number },
  ) => void;
  /** 多链接书签：打开入口选择弹窗（桌面网格传入；文件夹视图不传则维持直达）。 */
  onChooseLinks?: (view: BookmarkView) => void;
}

export function BookmarkTile({
  view,
  variant = 'tile',
  desktopId,
  pinned = false,
  dragging = false,
  dropPosition = null,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
  onChooseLinks,
}: BookmarkTileProps) {
  const settings = useSettings();
  const multi = !view.missing && (view.links?.length ?? 0) > 0;
  const chooseMode = settings.multiLinkClick === 'choose';
  const hue = siteHue(view.url, view.title);
  const favicon = useFavicon(view.missing ? null : view.url, 128);
  const hasFavicon = Boolean(favicon.src && !favicon.failed);
  const draggable = Boolean(onDragStart);

  function openMenuFromKeyboard(event: KeyboardEvent<HTMLElement>) {
    if (!onContextMenu) return;
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    onContextMenu(view, { x: rect.left + rect.width / 2, y: rect.bottom });
  }

  const commonProps = {
    className: variant === 'card' ? 'bookmark bookmark-card glass' : 'bookmark',
    'data-missing': view.missing ? 'true' : 'false',
    'data-dragging': dragging ? 'true' : 'false',
    'data-drop': dropPosition ?? undefined,
    draggable,
    ...(onDragStart
      ? { onDragStart: (event: DragEvent<HTMLElement>) => onDragStart(view, event) }
      : {}),
    ...(onDragEnd ? { onDragEnd } : {}),
    ...(onDragOver
      ? { onDragOver: (event: DragEvent<HTMLElement>) => onDragOver(view, event) }
      : {}),
    ...(onDrop ? { onDrop: (event: DragEvent<HTMLElement>) => onDrop(view, event) } : {}),
    ...(onContextMenu
      ? {
          onContextMenu: (event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            onContextMenu(view, event);
          },
          onKeyDown: openMenuFromKeyboard,
        }
      : {}),
    title: view.missing ? `${view.title}（书签已失效）` : view.title,
    'aria-label': view.missing ? `${view.title}，书签已失效` : view.title,
  };

  const content = (
    <>
      <span
        className={`bookmark-icon${favicon.loaded ? ' bookmark-icon--favicon' : ''}`}
        style={{ '--tile-hue': hue } as CSSProperties}
      >
        {view.missing ? (
          <WarningCircle size={20} weight="fill" />
        ) : (
          <>
            {favicon.loaded ? null : siteLetter(view.title, view.url)}
            {hasFavicon ? (
              <img
                className={`bookmark-favicon${favicon.loaded ? ' is-ready' : ''}`}
                src={favicon.src ?? undefined}
                alt=""
                width={40}
                height={40}
                draggable={false}
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={favicon.onLoad}
                onError={favicon.onError}
              />
            ) : null}
          </>
        )}
        {!view.missing ? (
          <span className="bookmark-badge" aria-hidden="true">
            {multi ? `+${view.links!.length}` : '↗'}
          </span>
        ) : null}
      </span>
      <span className="bookmark-label">{view.title}</span>
      {pinned ? <span className="bookmark-pin" aria-hidden="true" /> : null}
    </>
  );

  const cardContent = (
    <>
      <span
        className={`bookmark-icon bookmark-card__icon${favicon.loaded ? ' bookmark-icon--favicon' : ''}`}
        style={{ '--tile-hue': hue } as CSSProperties}
      >
        {view.missing ? (
          <WarningCircle size={18} weight="fill" />
        ) : (
          <>
            {favicon.loaded ? null : siteLetter(view.title, view.url)}
            {hasFavicon ? (
              <img
                className={`bookmark-favicon${favicon.loaded ? ' is-ready' : ''}`}
                src={favicon.src ?? undefined}
                alt=""
                width={40}
                height={40}
                draggable={false}
                decoding="async"
                referrerPolicy="no-referrer"
                onLoad={favicon.onLoad}
                onError={favicon.onError}
              />
            ) : null}
          </>
        )}
        {multi ? (
          <span className="bookmark-badge" aria-hidden="true">
            +{view.links!.length}
          </span>
        ) : null}
      </span>
      <span className="bookmark-card__body">
        <span className="bookmark-card__title">
          <span className="bookmark-card__name">{view.title}</span>
          {pinned ? <span className="bookmark-card__pin" aria-label="已钉在 Dock" /> : null}
          {view.tag
            ? view.tag
                .split(/[、,，;；]/)
                .map((t) => t.trim())
                .filter(Boolean)
                .map((t) => (
                  <span key={t} className="bookmark-card__tag">
                    {t}
                  </span>
                ))
            : null}
        </span>
        {!view.missing ? (
          <span className="bookmark-card__url">{prettyUrl(view.url)}</span>
        ) : (
          <span className="bookmark-card__url">书签已失效</span>
        )}
        {view.desc ? <span className="bookmark-card__desc">{view.desc}</span> : null}
      </span>
      {!view.missing ? (
        <button
          type="button"
          className={`bookmark-card__copy${multi && settings.multiLinkQuickButton ? ' bookmark-card__copy--shifted' : ''}`}
          title="复制网址"
          aria-label={`复制${view.title}的网址`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void navigator.clipboard
              .writeText(view.url)
              .then(() => pushToast('网址已复制。', 'success'))
              .catch(() => pushToast('复制失败，请重试。', 'error'));
          }}
        >
          <Copy size={14} />
        </button>
      ) : null}
      {multi && settings.multiLinkQuickButton ? (
        <button
          type="button"
          className="bookmark-card__quick"
          title={chooseMode ? '直达主链接（不弹窗）' : '选择入口'}
          aria-label={chooseMode ? `直达${view.title}主链接` : `选择${view.title}的入口`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (chooseMode) openUrl(view.url, true);
            else onChooseLinks?.(view);
          }}
        >
          {chooseMode ? <ArrowSquareOut size={14} /> : <List size={14} />}
        </button>
      ) : null}
    </>
  );

  function openMissingMenu(element: HTMLElement) {
    if (!onContextMenu) return;
    const rect = element.getBoundingClientRect();
    onContextMenu(view, { x: rect.left + rect.width / 2, y: rect.bottom });
  }

  if (view.missing) {
    return (
      <div
        {...commonProps}
        role="button"
        tabIndex={0}
        data-desktop-id={desktopId}
        onClick={(event) => openMissingMenu(event.currentTarget)}
        onKeyDown={(event) => {
          openMenuFromKeyboard(event);
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMissingMenu(event.currentTarget);
          }
        }}
      >
        {variant === 'card' ? cardContent : content}
      </div>
    );
  }

  return (
    <a
      {...commonProps}
      href={view.url}
      target="_blank"
      rel="noopener noreferrer"
      data-desktop-id={desktopId}
      onClick={(event) => {
        // 多链接 + 「弹窗选择」模式：整卡点击改为打开入口选择弹窗，不直达
        if (multi && chooseMode && onChooseLinks) {
          event.preventDefault();
          onChooseLinks(view);
        }
      }}
    >
      {variant === 'card' ? cardContent : content}
    </a>
  );
}
