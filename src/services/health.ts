// 站点状态（体检结果）前端存储：App 启动时拉一次 GET /api/healthcheck，
// 卡片上的状态点与设置「站点状态」页共用同一份数据。仅服务端模式可用。
import { createStore, useStore } from '../stores/create-store';
import { isServerMode } from './server-mode';

export interface HealthRow {
  status: string; // alive | restricted | dead | skipped
  detail?: string;
  checked_at?: number;
  fail_streak?: number;
}

interface HealthState {
  results: Map<number, HealthRow>;
  protectedIds: Set<number>;
  loaded: boolean;
}

export const healthStore = createStore<HealthState>({
  results: new Map(),
  protectedIds: new Set(),
  loaded: false,
});

let loading: Promise<void> | null = null;

export async function loadHealthResults(): Promise<void> {
  if (!isServerMode()) return;
  if (loading) return loading;
  loading = (async () => {
    try {
      const res = await fetch('/api/healthcheck');
      if (!res.ok) return;
      const body = (await res.json()) as {
        results: Array<{ site_id: number; status: string; detail?: string; checked_at?: number; fail_streak?: number }>;
        protectedIds: number[];
      };
      healthStore.setState({
        results: new Map((body.results || []).map((r) => [r.site_id, r])),
        protectedIds: new Set(body.protectedIds || []),
        loaded: true,
      });
    } catch {
      /* 读不到体检结果不阻塞页面 */
    } finally {
      loading = null;
    }
  })();
  return loading;
}

/** 手动体检/删除后把最新结果并回存储（卡片状态点随之更新）。 */
export function mergeHealthResults(
  rows: Array<{ id: number; status: string; detail?: string; checked_at?: number; fail_streak?: number; protected?: boolean }>,
): void {
  const state = healthStore.getState();
  const results = new Map(state.results);
  const protectedIds = new Set(state.protectedIds);
  for (const r of rows) {
    if (r.status !== 'skipped') results.set(r.id, r);
    if (r.protected) protectedIds.add(r.id);
  }
  healthStore.setState({ results, protectedIds, loaded: true });
}

export function removeHealthResults(ids: number[]): void {
  const state = healthStore.getState();
  const results = new Map(state.results);
  for (const id of ids) results.delete(id);
  healthStore.setState({ results });
}

const probedThisSession = new Set<number>();

/**
 * 点击自愈：用户点开带受限/失效标记的书签时，用用户自己的浏览器网络顺手探一次。
 * no-cors 探活只能确认「连得通」（对方有响应就算成功，读不到状态码）；
 * 成功就回报服务端清标记、红/琥珀点立刻消失；失败什么都不做。每个书签每次打开页面只探一次。
 */
export function probeAndClearBookmark(id: string, url: string): void {
  if (!isServerMode()) return;
  const numeric = Number(id);
  if (!Number.isFinite(numeric) || probedThisSession.has(numeric)) return;
  const row = healthStore.getState().results.get(numeric);
  if (!row || (row.status !== 'dead' && row.status !== 'restricted')) return;
  probedThisSession.add(numeric);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  fetch(url, { mode: 'no-cors', credentials: 'omit', signal: ctrl.signal })
    .then(async () => {
      const res = await fetch('/api/healthcheck/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: numeric }),
      });
      if (!res.ok) return;
      const state = healthStore.getState();
      const results = new Map(state.results);
      results.set(numeric, {
        status: 'alive',
        detail: '用户浏览器验证可达',
        checked_at: Date.now(),
        fail_streak: 0,
      });
      healthStore.setState({ results });
    })
    .catch(() => {
      /* 连不上：标记保留 */
    })
    .finally(() => clearTimeout(timer));
}

export function useHealthRow(siteId: string): HealthRow | undefined {
  const numeric = Number(siteId);
  return useStore(healthStore, (s) => (Number.isFinite(numeric) ? s.results.get(numeric) : undefined));
}

/** 展示用跳过判定（与服务端 hcSkipReason 同口径，仅用于列表里把内网站显示成「跳过」）。 */
export function clientSkipReason(catelog: string, url: string): string | null {
  if (catelog === '内网服务') return '内网分类，跳过';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '网址无效，跳过';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '非 http(s)，跳过';
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return '本地地址，跳过';
  if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h)) return '内网地址，跳过';
  return null;
}
