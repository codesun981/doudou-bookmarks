import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ArrowClockwise, BellRinging, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import type { WidgetInstance } from '../../../types/widget';
import { WidgetFrame } from '../common/WidgetFrame';
import { ConfirmDialog, Modal } from '../../ui/Modal';
import { isServerMode } from '../../../services/server-mode';
import {
  createSubscription,
  dateOnly,
  daysUntilExpiry,
  deleteSubscription,
  fetchSubscriptions,
  PERIOD_UNIT_LABELS,
  updateSubscription,
} from '../../../services/subs';
import type { Subscription, SubscriptionDraft } from '../../../services/subs';
import { pushToast } from '../../../stores/ui-store';

interface SubsWidgetProps {
  widget: WidgetInstance;
  compact: boolean;
  canvasWidth: number;
  canvasHeight: number;
}

function daysLabel(days: number): string {
  if (!Number.isFinite(days)) return '日期异常';
  if (days < 0) return `已过期 ${-days} 天`;
  if (days === 0) return '今天到期';
  return `剩 ${days} 天`;
}

function daysColor(sub: Subscription, days: number): string {
  if (!Number.isFinite(days) || days < 0) return '#ff6961';
  if (days <= (sub.reminderDays || 0)) return '#ffb340';
  return 'rgb(255 255 255 / 62%)';
}

const inputStyle: CSSProperties = {
  width: '100%',
  height: 34,
  borderRadius: 9,
  padding: '0 10px',
  fontSize: 12.5,
  border: '1px solid rgb(127 140 180 / 30%)',
  background: 'rgb(127 140 180 / 10%)',
  color: 'inherit',
  outline: 'none',
  colorScheme: 'dark',
};

const labelStyle: CSSProperties = { fontSize: 11.5, opacity: 0.65, marginBottom: 4, display: 'block' };

export function SubsWidget({ widget, compact, canvasWidth, canvasHeight }: SubsWidgetProps) {
  const serverMode = isServerMode();
  const [subs, setSubs] = useState<Subscription[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSubs(await fetchSubscriptions());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (serverMode) void load();
  }, [serverMode, load]);

  const active = (subs ?? [])
    .filter((s) => s.isActive !== false)
    .sort((a, b) => daysUntilExpiry(a.expiryDate) - daysUntilExpiry(b.expiryDate));

  return (
    <WidgetFrame
      widget={widget}
      title="订阅到期"
      icon={<BellRinging size={13} />}
      compact={compact}
      canvasWidth={canvasWidth}
      canvasHeight={canvasHeight}
    >
      {!serverMode ? (
        <p style={{ fontSize: 12.5, opacity: 0.7, lineHeight: 1.6, padding: '6px 2px' }}>
          订阅到期只在云端版可用（数据与续期提醒站共享）。
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 6 }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', scrollbarWidth: 'none' }}>
            {subs === null && !failed ? (
              <p style={{ fontSize: 12.5, opacity: 0.6, padding: '8px 2px' }}>正在读取订阅…</p>
            ) : failed ? (
              <p style={{ fontSize: 12.5, opacity: 0.6, padding: '8px 2px' }}>读取失败，点下方刷新重试。</p>
            ) : active.length === 0 ? (
              <p style={{ fontSize: 12.5, opacity: 0.6, padding: '8px 2px', lineHeight: 1.6 }}>
                还没有生效中的订阅，点「管理」添加。
              </p>
            ) : (
              active.slice(0, 5).map((sub) => {
                const days = daysUntilExpiry(sub.expiryDate);
                return (
                  <div
                    key={String(sub.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '5px 2px',
                      borderBottom: '1px solid rgb(255 255 255 / 5%)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 600,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {sub.name}
                        {sub.customType ? (
                          <span style={{ fontSize: 10.5, fontWeight: 500, opacity: 0.55, marginLeft: 6 }}>
                            {sub.customType}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11, opacity: 0.55 }}>
                        {dateOnly(sub.expiryDate)} 到期
                        {sub.autoRenew ? ' · 自动续费' : ''}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 650, color: daysColor(sub, days), flex: 'none' }}>
                      {daysLabel(days)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
            <span style={{ fontSize: 11, opacity: 0.5, flex: 1 }}>
              {subs ? `共 ${subs.length} 条 · 提醒由续期站发送` : ''}
            </span>
            <button type="button" className="chip" onClick={() => void load()} aria-label="刷新订阅">
              <ArrowClockwise size={12} />
            </button>
            <button type="button" className="chip" onClick={() => setManageOpen(true)}>
              管理
            </button>
          </div>
        </div>
      )}
      {serverMode ? (
        <SubsManageModal
          open={manageOpen}
          onClose={() => setManageOpen(false)}
          subs={subs ?? []}
          onChanged={() => void load()}
        />
      ) : null}
    </WidgetFrame>
  );
}

const EMPTY_DRAFT: SubscriptionDraft = {
  name: '',
  customType: '',
  startDate: '',
  expiryDate: '',
  periodValue: 1,
  periodUnit: 'year',
  autoRenew: true,
  reminderDays: 30,
  notes: '',
  isActive: true,
};

function draftFrom(sub: Subscription): SubscriptionDraft {
  return {
    name: sub.name ?? '',
    customType: sub.customType ?? '',
    startDate: dateOnly(sub.startDate ?? ''),
    expiryDate: dateOnly(sub.expiryDate ?? ''),
    periodValue: sub.periodValue || 1,
    periodUnit: sub.periodUnit || 'year',
    autoRenew: Boolean(sub.autoRenew),
    reminderDays: sub.reminderDays ?? 30,
    notes: sub.notes ?? '',
    isActive: sub.isActive !== false,
  };
}

function computeExpiry(draft: SubscriptionDraft): string {
  if (!draft.startDate) return '';
  const start = new Date(`${draft.startDate}T00:00:00`);
  if (Number.isNaN(start.getTime())) return '';
  const expiry = new Date(start);
  if (draft.periodUnit === 'day') expiry.setDate(expiry.getDate() + draft.periodValue);
  else if (draft.periodUnit === 'month') expiry.setMonth(expiry.getMonth() + draft.periodValue);
  else expiry.setFullYear(expiry.getFullYear() + draft.periodValue);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${expiry.getFullYear()}-${pad(expiry.getMonth() + 1)}-${pad(expiry.getDate())}`;
}

function SubsManageModal({
  open,
  onClose,
  subs,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  subs: Subscription[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<{ id: string | null; draft: SubscriptionDraft } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Subscription | null>(null);
  const [saving, setSaving] = useState(false);

  const sorted = [...subs].sort((a, b) => daysUntilExpiry(a.expiryDate) - daysUntilExpiry(b.expiryDate));

  async function save() {
    if (!editing) return;
    if (!editing.draft.name.trim() || !editing.draft.expiryDate) {
      pushToast('名称和到期日必填', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing.id) await updateSubscription(editing.id, editing.draft);
      else await createSubscription(editing.draft);
      pushToast('已保存', 'success');
      setEditing(null);
      onChanged();
    } catch {
      pushToast('保存失败，请重试', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!pendingDelete) return;
    try {
      await deleteSubscription(String(pendingDelete.id));
      pushToast('已删除', 'success');
      onChanged();
    } catch {
      pushToast('删除失败，请重试', 'error');
    } finally {
      setPendingDelete(null);
    }
  }

  const d = editing?.draft;
  const set = (patch: Partial<SubscriptionDraft>) =>
    setEditing((cur) => (cur ? { ...cur, draft: { ...cur.draft, ...patch } } : cur));

  return (
    <>
      <Modal open={open} onClose={onClose} label="订阅管理" className="modal--sheet">
        <h2 className="modal__title">订阅管理</h2>
        <p className="modal__text" style={{ marginBottom: 6 }}>
          与续期提醒站同一份数据，在这里改完，那边发提醒时用的也是新日期。
        </p>
        {editing && d ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <div>
              <span style={labelStyle}>名称 *</span>
              <input
                style={inputStyle}
                value={d.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="如 example.com / 某会员"
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <span style={labelStyle}>类型</span>
                <input
                  style={inputStyle}
                  value={d.customType}
                  onChange={(e) => set({ customType: e.target.value })}
                  placeholder="域名 / 会员 / 软件…"
                />
              </div>
              <div style={{ flex: 1 }}>
                <span style={labelStyle}>开始日期</span>
                <input
                  style={inputStyle}
                  type="date"
                  value={d.startDate}
                  onChange={(e) => set({ startDate: e.target.value })}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <span style={labelStyle}>周期</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    style={{ ...inputStyle, width: 64, flex: 'none' }}
                    type="number"
                    min={1}
                    max={999}
                    value={d.periodValue}
                    onChange={(e) => set({ periodValue: Math.max(1, Number(e.target.value) || 1) })}
                  />
                  <select
                    style={inputStyle}
                    value={d.periodUnit}
                    onChange={(e) => set({ periodUnit: e.target.value as Subscription['periodUnit'] })}
                  >
                    <option value="day">天</option>
                    <option value="month">个月</option>
                    <option value="year">年</option>
                  </select>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <span style={labelStyle}>到期日 *</span>
                <input
                  style={inputStyle}
                  type="date"
                  value={d.expiryDate}
                  onChange={(e) => set({ expiryDate: e.target.value })}
                />
              </div>
              <button
                type="button"
                className="chip"
                style={{ flex: 'none', height: 34 }}
                onClick={() => {
                  const v = computeExpiry(d);
                  if (v) set({ expiryDate: v });
                  else pushToast('先填开始日期', 'error');
                }}
              >
                按周期算
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <span style={labelStyle}>提前提醒（天）</span>
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  max={365}
                  value={d.reminderDays}
                  onChange={(e) => set({ reminderDays: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div style={{ flex: 1 }}>
                <span style={labelStyle}>备注</span>
                <input
                  style={inputStyle}
                  value={d.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  placeholder="可选"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12.5 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={d.autoRenew}
                  onChange={(e) => set({ autoRenew: e.target.checked })}
                />
                自动续费
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={d.isActive}
                  onChange={(e) => set({ isActive: e.target.checked })}
                />
                启用（停用后不提醒）
              </label>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn btn--glass" onClick={() => setEditing(null)}>
                取消
              </button>
              <button type="button" className="btn btn--primary" disabled={saving} onClick={() => void save()}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sorted.length === 0 ? (
              <p style={{ fontSize: 12.5, opacity: 0.6, padding: '6px 0' }}>暂无订阅。</p>
            ) : (
              sorted.map((sub) => {
                const days = daysUntilExpiry(sub.expiryDate);
                return (
                  <div
                    key={String(sub.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '13px 0',
                      borderBottom: '1px solid rgb(255 255 255 / 6%)',
                      opacity: sub.isActive === false ? 0.45 : 1,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.45 }}>
                        {sub.name}
                        {sub.customType ? (
                          <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.55, marginLeft: 7 }}>{sub.customType}</span>
                        ) : null}
                        {sub.isActive === false ? (
                          <span style={{ fontSize: 11, fontWeight: 500, opacity: 0.7, marginLeft: 7 }}>已停用</span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.55, marginTop: 3 }}>
                        {dateOnly(sub.expiryDate)} 到期 · 每 {sub.periodValue}
                        {PERIOD_UNIT_LABELS[sub.periodUnit] || '年'} · 提前 {sub.reminderDays} 天提醒
                        {sub.autoRenew ? ' · 自动续费' : ''}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 650,
                        color: daysColor(sub, days),
                        background: 'rgb(255 255 255 / 7%)',
                        padding: '4px 11px',
                        borderRadius: 999,
                        flex: 'none',
                      }}
                    >
                      {daysLabel(days)}
                    </span>
                    <button
                      type="button"
                      className="chip"
                      style={{ width: 32, height: 32, justifyContent: 'center', flex: 'none' }}
                      aria-label={`编辑 ${sub.name}`}
                      onClick={() => setEditing({ id: String(sub.id), draft: draftFrom(sub) })}
                    >
                      <PencilSimple size={13} />
                    </button>
                    <button
                      type="button"
                      className="chip"
                      style={{ width: 32, height: 32, justifyContent: 'center', flex: 'none' }}
                      aria-label={`删除 ${sub.name}`}
                      onClick={() => setPendingDelete(sub)}
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                );
              })
            )}
            <div className="modal__actions" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="btn btn--glass"
                onClick={() => setEditing({ id: null, draft: { ...EMPTY_DRAFT } })}
              >
                <Plus size={13} style={{ marginRight: 4, verticalAlign: -2 }} />
                新增订阅
              </button>
              <button type="button" className="btn btn--primary" onClick={onClose}>
                完成
              </button>
            </div>
          </div>
        )}
      </Modal>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="删除订阅"
        body={`确定删除「${pendingDelete?.name ?? ''}」吗？续期提醒站那边也会同步删除，不再发它的到期提醒。`}
        confirmLabel="删除"
        danger
        onConfirm={() => void doDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
