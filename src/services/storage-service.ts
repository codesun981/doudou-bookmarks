import { createMigrationBackup } from '../utils/migration';
import { isServerMode } from './server-mode';
import { pushToast } from '../stores/ui-store';
import { CORE_KEYS, STORAGE_KEYS, type RawStorage } from '../utils/storage-keys';

const LOCAL_PREFIX = 'glassdesk:storage:';
const MIRROR_KEY = 'glassdesk:mirror:v1';
const MIRROR_LIMIT = 1_200_000;

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageChanges = Record<string, StorageChange>;
type ChangeListener = (changes: StorageChanges) => void;

interface Backend {
  get(keys: string[]): Promise<RawStorage>;
  getAll(): Promise<RawStorage>;
  set(items: RawStorage): Promise<void>;
  remove(keys: string[]): Promise<void>;
  bytesInUse(): Promise<number>;
}

function chromeStorageAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.local !== 'undefined'
  );
}

function readLocalRaw(): RawStorage {
  const result: RawStorage = {};
  if (typeof localStorage === 'undefined') return result;
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(LOCAL_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      result[key.slice(LOCAL_PREFIX.length)] = JSON.parse(raw);
    } catch {
      // Ignore a corrupted value; parsing/migration will rebuild defaults.
    }
  }
  return result;
}

function writeLocalItems(items: RawStorage): StorageChanges {
  const changes: StorageChanges = {};
  for (const [key, value] of Object.entries(items)) {
    const storageKey = `${LOCAL_PREFIX}${key}`;
    const previous = localStorage.getItem(storageKey);
    let oldValue: unknown;
    if (previous) {
      try {
        oldValue = JSON.parse(previous);
      } catch {
        oldValue = undefined;
      }
    }
    localStorage.setItem(storageKey, JSON.stringify(value));
    changes[key] = { oldValue, newValue: value };
  }
  return changes;
}


// 豆豆书签（fork）：云端 Backend——整份 RawStorage 存 Worker 的 D1（ui_state 表，带版本号）。
// 本地 localStorage 留一份 {version, data} 缓存：打开先用本地秒开，后台用 /api/version
// 做小校验，版本一致就不拉全量；写入带 baseVersion 乐观锁，409 时以云端为准刷新本地。
const SERVER_CACHE_KEY = 'glassdesk:server-cache:v1';
interface ServerCache { version: number; data: RawStorage }
function loadServerCache(): ServerCache | null {
  try {
    const raw = localStorage.getItem(SERVER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ServerCache;
    if (typeof parsed.version !== 'number' || !parsed.data || typeof parsed.data !== 'object') return null;
    return parsed;
  } catch { return null; }
}
function persistServerCache(version: number, data: RawStorage): void {
  try { localStorage.setItem(SERVER_CACHE_KEY, JSON.stringify({ version, data })); } catch { /* 存不下就算了 */ }
}
function createServerBackend(): Backend {
  let cache: RawStorage | null = null;
  let version = 0;
  let putTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSentBody = '';
  let lastSentAt = 0;
  let dirty = false;

  async function fetchServerStorage(): Promise<ServerCache | null> {
    try {
      const res = await fetch('/api/storage');
      if (!res.ok) return null;
      const body = (await res.json()) as { version: number; data: RawStorage };
      return { version: body.version, data: body.data || {} };
    } catch { return null; }
  }
  function adopt(remote: ServerCache): void {
    const previous = cache ?? {};
    cache = remote.data;
    version = remote.version;
    persistServerCache(version, cache);
    lastSentBody = JSON.stringify(cache);
    dirty = false;
    const changes: StorageChanges = {};
    for (const key of Object.keys(cache)) changes[key] = { oldValue: previous[key], newValue: cache[key] };
    for (const key of Object.keys(previous)) {
      if (!(key in cache)) changes[key] = { oldValue: previous[key], newValue: undefined };
    }
    if (Object.keys(changes).length > 0) dispatchLocalChanges(changes);
  }
  async function ensure(): Promise<RawStorage> {
    if (cache) return cache;
    const local = loadServerCache();
    if (local) {
      cache = local.data;
      version = local.version;
      lastSentBody = JSON.stringify(cache);
      // 后台校验：版本变了才拉全量（不阻塞首屏渲染，拉到后 adopt 刷新）
      void (async () => {
        try {
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 4000);
          const res = await fetch('/api/version', { signal: ctl.signal });
          clearTimeout(timer);
          if (!res.ok) return;
          const v = (await res.json()) as { storage?: number };
          if (typeof v.storage === 'number' && v.storage !== version) {
            const remote = await fetchServerStorage();
            if (remote && remote.version !== version) adopt(remote);
          }
        } catch { /* 离线/超时就用本地缓存，下次打开再校验 */ }
      })();
      return cache;
    }
    const remote = await fetchServerStorage();
    cache = remote ? remote.data : {};
    version = remote ? remote.version : 0;
    if (remote) persistServerCache(version, cache);
    lastSentBody = JSON.stringify(cache);
    return cache;
  }
  async function sendPut(): Promise<void> {
    if (!cache) return;
    const body = JSON.stringify(cache);
    if (body === lastSentBody) { dirty = false; return; }
    try {
      const res = await fetch('/api/storage', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseVersion: version, data: cache }),
        keepalive: true,
      });
      if (res.ok) {
        const out = (await res.json()) as { version: number };
        version = out.version;
        lastSentBody = body;
        lastSentAt = Date.now();
        dirty = false;
        persistServerCache(version, cache);
      } else if (res.status === 409) {
        // 别的设备先改了：以云端为准（本端未保存的改动让位），避免整份覆盖互踩；
        // 但不能静默——明确告诉用户这次改动没存上（2026-11-22 审计 D 项）。
        const remote = await fetchServerStorage();
        if (remote) {
          forgetLocalWrites(Object.keys(remote.data));
          adopt(remote);
          pushToast('云端已有更新（可能来自另一台设备或另一个标签页），刚才这次改动未保存，已同步为云端版本', 'error');
        }
      } else {
        // 其他拒绝（400 存储防护 / 413 过大 / 401 门过期等）此前会静默丢弃保存，
        // 用户改了半天都不知道没存上——一律出声（2026-11-22 审计 D 项实测发现）。
        pushToast('这次改动没有保存成功（服务器拒绝了写入），请刷新页面后重试', 'error');
      }
    } catch { /* 网络失败保持 dirty，下次 set 或 pagehide 再试 */ }
  }
  function schedulePut(): void {
    dirty = true;
    if (cache) persistServerCache(version, cache);
    if (putTimer) clearTimeout(putTimer);
    const wait = Math.max(250, 2_000 - (Date.now() - lastSentAt));
    putTimer = setTimeout(() => { void sendPut(); }, wait);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => { if (dirty) void sendPut(); });
  }
  return {
    async get(keys) {
      const all = await ensure();
      const result: RawStorage = {};
      for (const key of keys) {
        if (key in all) result[key] = all[key];
      }
      return result;
    },
    async getAll() {
      return { ...(await ensure()) };
    },
    async set(items) {
      const all = await ensure();
      const changes: StorageChanges = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: all[key], newValue: value };
        all[key] = value;
      }
      dispatchLocalChanges(changes);
      schedulePut();
    },
    async remove(keys) {
      const all = await ensure();
      const changes: StorageChanges = {};
      for (const key of keys) {
        changes[key] = { oldValue: all[key], newValue: undefined };
        delete all[key];
      }
      dispatchLocalChanges(changes);
      schedulePut();
    },
    async bytesInUse() {
      const all = await ensure();
      try {
        return new Blob([JSON.stringify(all)]).size;
      } catch {
        return 0;
      }
    },
  };
}

function createBackend(): Backend {
  if (isServerMode()) {
    return createServerBackend();
  }

  if (chromeStorageAvailable()) {
    return {
      async get(keys) {
        return (await chrome.storage.local.get(keys)) as RawStorage;
      },
      async getAll() {
        return (await chrome.storage.local.get(null)) as RawStorage;
      },
      async set(items) {
        await chrome.storage.local.set(items);
      },
      async remove(keys) {
        await chrome.storage.local.remove(keys);
      },
      async bytesInUse() {
        return chrome.storage.local.getBytesInUse(null);
      },
    };
  }

  return {
    async get(keys) {
      const all = readLocalRaw();
      const result: RawStorage = {};
      for (const key of keys) {
        if (key in all) result[key] = all[key];
      }
      return result;
    },
    async getAll() {
      return readLocalRaw();
    },
    async set(items) {
      const changes = writeLocalItems(items);
      dispatchLocalChanges(changes);
    },
    async remove(keys) {
      const changes: StorageChanges = {};
      for (const key of keys) {
        const oldValue = readLocalRaw()[key];
        localStorage.removeItem(`${LOCAL_PREFIX}${key}`);
        changes[key] = { oldValue, newValue: undefined };
      }
      dispatchLocalChanges(changes);
    },
    async bytesInUse() {
      try {
        return new Blob([JSON.stringify(readLocalRaw())]).size;
      } catch {
        return 0;
      }
    },
  };
}

const backend = createBackend();
const listeners = new Set<ChangeListener>();
let subscribed = false;

function isCoreKey(key: string): boolean {
  return (CORE_KEYS as readonly string[]).includes(key);
}

function filterCore(changes: StorageChanges): StorageChanges {
  const filtered: StorageChanges = {};
  for (const [key, change] of Object.entries(changes)) {
    if (isCoreKey(key)) filtered[key] = change;
  }
  return filtered;
}

function dispatchLocalChanges(changes: StorageChanges): void {
  updateMirror(changes);
  for (const listener of listeners) listener(changes);
}

function handleChromeChanges(changes: Record<string, StorageChange>, areaName: string): void {
  if (areaName !== 'local') return;
  const core = filterCore(changes);
  if (Object.keys(core).length === 0) return;
  updateMirror(core);
  for (const listener of listeners) listener(core);
}

function ensureSubscription(): void {
  if (subscribed) return;
  subscribed = true;
  if (chromeStorageAvailable()) {
    chrome.storage.onChanged.addListener(handleChromeChanges);
  } else if (typeof window !== 'undefined') {
    window.addEventListener('glassdesk:storage', ((event: CustomEvent<StorageChanges>) => {
      const core = filterCore(event.detail ?? {});
      if (Object.keys(core).length === 0) return;
      for (const listener of listeners) listener(core);
    }) as EventListener);
  }
}

function readMirrorObject(): RawStorage {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as RawStorage)
      : {};
  } catch {
    return {};
  }
}

function updateMirror(items: RawStorage, removed: string[] = []): void {
  if (!chromeStorageAvailable() || typeof localStorage === 'undefined') return;
  try {
    const next = readMirrorObject();
    for (const [key, value] of Object.entries(items)) {
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    for (const key of removed) delete next[key];
    let serialized = JSON.stringify(next);
    if (serialized.length > MIRROR_LIMIT) {
      delete next[STORAGE_KEYS.bookmarkCache];
      serialized = JSON.stringify(next);
    }
    if (serialized.length <= MIRROR_LIMIT) localStorage.setItem(MIRROR_KEY, serialized);
  } catch {
    // The mirror is only a warm-start optimization; never fail a write for it.
  }
}

/**
 * A synchronous best-effort snapshot for the first paint. chrome.storage is
 * asynchronous, so the page paints from this mirror and hydrates right after.
 */
export function readStartupMirror(): RawStorage {
  if (!chromeStorageAvailable()) return readLocalRaw();
  const mirror = readMirrorObject();
  const result: RawStorage = {};
  for (const key of CORE_KEYS) {
    if (key in mirror) result[key] = mirror[key];
  }
  return result;
}

export function refreshStartupMirror(raw: RawStorage): void {
  if (!chromeStorageAvailable()) return;
  const core: RawStorage = {};
  for (const key of CORE_KEYS) {
    if (key in raw) core[key] = raw[key];
  }
  updateMirror(core);
}

const queues = new Map<string, Promise<void>>();
const recentWrites = new Map<string, number>();

function markLocalWrites(keys: string[]): void {
  const now = Date.now();
  for (const key of keys) recentWrites.set(key, now);
}

/** 清掉「本页刚写过」的标记：版本冲突 adopt 云端状态时用，否则订阅方会把
 * 云端状态误判成本页自己的写入而跳过刷新，界面停在未保存的假状态上。 */
function forgetLocalWrites(keys: string[]): void {
  for (const key of keys) recentWrites.delete(key);
}

export function wasRecentlyWrittenByThisTab(keys: string[], windowMs = 1500): boolean {
  if (keys.length === 0) return false;
  const now = Date.now();
  return keys.every((key) => now - (recentWrites.get(key) ?? 0) < windowMs);
}

function enqueue(key: string, task: () => Promise<void>): Promise<void> {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  queues.set(key, run);
  void run.finally(() => {
    if (queues.get(key) === run) queues.delete(key);
  }).catch(() => undefined);
  return run;
}

async function readRaw(): Promise<RawStorage> {
  return backend.getAll();
}

async function readKeys(keys: string[]): Promise<RawStorage> {
  return backend.get(keys);
}

async function writeItems(items: RawStorage): Promise<void> {
  markLocalWrites(Object.keys(items));
  await backend.set(items);
  updateMirror(items);
}

/**
 * Read-modify-write a single storage key. Mutations are serialized per key and
 * always start from the latest stored value so two tabs cannot blindly
 * overwrite each other's whole configuration.
 */
function mutateKey<T>(key: string, mutator: (current: T | undefined) => T | undefined): Promise<void> {
  return enqueue(key, async () => {
    const raw = await backend.get([key]);
    const next = mutator(raw[key] as T | undefined);
    if (next === undefined) return;
    markLocalWrites([key]);
    await backend.set({ [key]: next });
    updateMirror({ [key]: next });
  });
}

async function removeKeys(keys: string[]): Promise<void> {
  await backend.remove(keys);
  updateMirror({}, keys);
}

async function backupRaw(raw: RawStorage, reason: string): Promise<void> {
  await writeItems({ [STORAGE_KEYS.backup]: createMigrationBackup(raw, reason) });
}

async function resetAll(): Promise<void> {
  await removeKeys([...CORE_KEYS, STORAGE_KEYS.faviconRefresh, STORAGE_KEYS.backup]);
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(MIRROR_KEY);
    } catch {
      // No-op.
    }
  }
}

function subscribe(listener: ChangeListener): () => void {
  ensureSubscription();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function bytesInUse(): Promise<number> {
  try {
    return await backend.bytesInUse();
  } catch {
    return 0;
  }
}

export const storageService = {
  readRaw,
  readKeys,
  writeItems,
  mutateKey,
  removeKeys,
  backupRaw,
  resetAll,
  subscribe,
  bytesInUse,
  isExtensionStorage: chromeStorageAvailable(),
};
