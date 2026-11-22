// 订阅到期前端服务：数据在旧 sub 站（sub.sunshine98168.workers.dev）的 KV 里，
// doudou Worker 只做同源代理读写同一份 'subscriptions' 数据（方案 A，2026-11-22）。
// 提醒通知仍由旧站的定时任务发送，本服务不涉及任何密钥与配置。
export interface Subscription {
  id: string;
  name: string;
  customType: string;
  startDate: string;
  expiryDate: string;
  periodValue: number;
  periodUnit: 'day' | 'month' | 'year';
  autoRenew: boolean;
  reminderDays: number;
  notes: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type SubscriptionDraft = Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>;

export const PERIOD_UNIT_LABELS: Record<Subscription['periodUnit'], string> = {
  day: '天',
  month: '个月',
  year: '年',
};

/** 距到期还有几天（按本地日期对齐；已过期为负数）。日期解析失败返回 Infinity。 */
export function daysUntilExpiry(expiryDate: string, now = new Date()): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(expiryDate || '');
  if (!m) return Number.POSITIVE_INFINITY;
  const target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function dateOnly(value: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(value || '') ? value.slice(0, 10) : '';
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error || `请求失败（${res.status}）`);
  return body as T;
}

export async function fetchSubscriptions(): Promise<Subscription[]> {
  const body = await call<{ subscriptions: Subscription[] }>('/api/subs');
  return Array.isArray(body.subscriptions) ? body.subscriptions : [];
}

export async function createSubscription(draft: SubscriptionDraft): Promise<Subscription> {
  const body = await call<{ subscription: Subscription }>('/api/subs', {
    method: 'POST',
    body: JSON.stringify(draft),
  });
  return body.subscription;
}

export async function updateSubscription(id: string, draft: SubscriptionDraft): Promise<Subscription> {
  const body = await call<{ subscription: Subscription }>(`/api/subs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(draft),
  });
  return body.subscription;
}

export async function deleteSubscription(id: string): Promise<void> {
  await call(`/api/subs/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
