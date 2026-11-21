import type { DragEvent, KeyboardEvent, MouseEvent } from 'react';
import type { BookmarkView } from '../../stores/desktop-store';

interface FolderTileProps {
  view: BookmarkView;
  variant?: 'tile' | 'card';
  desktopId?: string;
  dragging?: boolean;
  dropPosition?: 'before' | 'after' | null;
  onOpen: (folderId: string) => void;
  onDragStart?: (view: BookmarkView, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  onDragOver?: (view: BookmarkView, event: DragEvent<HTMLElement>) => void;
  onDrop?: (view: BookmarkView, event: DragEvent<HTMLElement>) => void;
  onContextMenu?: (view: BookmarkView, event: MouseEvent<HTMLElement>) => void;
}

export function FolderTile({
  view,
  variant = 'tile',
  desktopId,
  dragging = false,
  dropPosition = null,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
}: FolderTileProps) {
  const count = view.count ?? 0;

  function open() {
    if (!view.missing) onOpen(view.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  }

  return (
    <div
      className={
        variant === 'card' ? 'bookmark bookmark--folder bookmark-card glass' : 'bookmark bookmark--folder'
      }
      data-missing={view.missing ? 'true' : 'false'}
      data-dragging={dragging ? 'true' : 'false'}
      data-drop={dropPosition ?? undefined}
      data-desktop-id={desktopId}
      role="button"
      tabIndex={0}
      draggable={Boolean(onDragStart)}
      title={view.title}
      aria-label={`${view.title}，文件夹，${count} 个书签`}
      onClick={open}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!onContextMenu) return;
        onContextMenu(view, event);
      }}
      {...(onDragStart
        ? { onDragStart: (event: DragEvent<HTMLElement>) => onDragStart(view, event) }
        : {})}
      {...(onDragEnd ? { onDragEnd } : {})}
      {...(onDragOver
        ? { onDragOver: (event: DragEvent<HTMLElement>) => onDragOver(view, event) }
        : {})}
      {...(onDrop ? { onDrop: (event: DragEvent<HTMLElement>) => onDrop(view, event) } : {})}
    >
      {variant === 'card' ? (
        <>
          <span className="bookmark-icon bookmark-card__icon bookmark-icon--folder">
            <img src="/icons/mac/folder.png" alt="" width={34} height={34} draggable={false} />
          </span>
          <span className="bookmark-card__body">
            <span className="bookmark-card__title">
              <span className="bookmark-card__name">{view.title}</span>
            </span>
            <span className="bookmark-card__url">{count} 个书签</span>
          </span>
        </>
      ) : (
        <>
          <span className="bookmark-icon bookmark-icon--folder">
            <img src="/icons/mac/folder.png" alt="" width={54} height={54} draggable={false} />
            {count > 0 ? (
              <span className="bookmark-folder-count" aria-hidden="true">
                {count}
              </span>
            ) : null}
          </span>
          <span className="bookmark-label">{view.title}</span>
        </>
      )}
    </div>
  );
}
