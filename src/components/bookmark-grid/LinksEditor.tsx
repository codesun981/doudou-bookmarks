import { Plus, X } from '@phosphor-icons/react';
import type { BookmarkLink } from '../../types/bookmark';

/** 多链接书签的副链接编辑器（书签编辑弹窗与设置页书签管理共用）。 */
export function LinksEditor({
  links,
  onChange,
}: {
  links: BookmarkLink[];
  onChange: (links: BookmarkLink[]) => void;
}) {
  const update = (index: number, patch: Partial<BookmarkLink>) => {
    onChange(links.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };
  return (
    <div className="le-editor">
      {links.map((link, index) => (
        <div className="le-row" key={index}>
          <input
            className="le-label"
            value={link.label}
            placeholder="入口名，如：后台"
            maxLength={30}
            onChange={(e) => update(index, { label: e.target.value })}
          />
          <input
            className="le-url"
            value={link.url}
            placeholder="https://…"
            inputMode="url"
            onChange={(e) => update(index, { url: e.target.value })}
          />
          <button
            type="button"
            className="le-remove"
            title="删除这个入口"
            onClick={() => onChange(links.filter((_, i) => i !== index))}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {links.length < 10 ? (
        <button
          type="button"
          className="le-add"
          onClick={() => onChange([...links, { label: '', url: '' }])}
        >
          <Plus size={13} />
          添加副链接（同一服务的其他入口）
        </button>
      ) : null}
    </div>
  );
}

/** 保存前清洗：只留填了合法网址的行。 */
export function cleanLinks(links: BookmarkLink[]): BookmarkLink[] {
  return links
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }))
    .filter((l) => /^https?:\/\//i.test(l.url))
    .slice(0, 10);
}
