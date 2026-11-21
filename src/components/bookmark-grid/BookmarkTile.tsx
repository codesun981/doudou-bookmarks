import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import type { BookmarkView } from '../../stores/desktop-store';
import { useFavicon } from '../../hooks/use-favicon';
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
}: BookmarkTileProps) {
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
            ↗
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
      </span>
      <span className="bookmark-card__body">
        <span className="bookmark-card__title">
          <span className="bookmark-card__name">{view.title}</span>
          {pinned ? <span className="bookmark-card__pin" aria-label="已钉在 Dock" /> : null}
        </span>
        {!view.missing ? (
          <span className="bookmark-card__url">{prettyUrl(view.url)}</span>
        ) : (
          <span className="bookmark-card__url">书签已失效</span>
        )}
        {view.desc ? <span className="bookmark-card__desc">{view.desc}</span> : null}
      </span>
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
    <a {...commonProps} href={view.url} data-desktop-id={desktopId}>
      {variant === 'card' ? cardContent : content}
    </a>
  );
}
