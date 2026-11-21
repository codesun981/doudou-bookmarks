export const TAG_SEPARATORS = /[、,，;；]/;

export function splitTagString(tag: string | null | undefined): string[] {
  if (!tag) return [];
  return [...new Set(tag.split(TAG_SEPARATORS).map((s) => s.trim()).filter(Boolean))];
}

/** 已有标签点选器：点一下加入、再点一下移除（值以顿号连接）。 */
export function TagChips({
  value,
  onChange,
  known,
}: {
  value: string;
  onChange: (next: string) => void;
  known: string[];
}) {
  if (known.length === 0) return null;
  const current = splitTagString(value);
  const toggle = (t: string) => {
    const next = current.includes(t) ? current.filter((s) => s !== t) : [...current, t];
    onChange(next.join('、'));
  };
  return (
    <div className="tag-chips" aria-label="已有标签，点选添加或移除">
      {known.map((t) => (
        <button
          key={t}
          type="button"
          className="tag-chip"
          data-active={current.includes(t)}
          onClick={() => toggle(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
