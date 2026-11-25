/**
 * chrome.storage.local 数据访问层。
 */
import { DEFAULT_SETTINGS, STORAGE_KEYS } from './constants';
import type {
  AppSnapshot,
  CookieVaultEntry,
  LoginFlowState,
  PersistedLoginFlow,
  Settings,
  SiteConfig,
  SiteSession,
} from './types';

async function readValue<T>(key: string, fallback: T): Promise<T> {
  const result = await chrome.storage.local.get(key);
  const value = result[key];
  return value === undefined ? fallback : (value as T);
}

async function writeValue<T>(key: string, value: T): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

/** 默认值合并，保证旧版本存储缺字段时仍可用。 */
function mergeSettings(raw: Partial<Settings> | undefined): Settings {
  return { ...DEFAULT_SETTINGS, ...(raw ?? {}) };
}

export const storage = {
  async getSites(): Promise<SiteConfig[]> {
    const sites = await readValue<SiteConfig[]>(STORAGE_KEYS.sites, []);
    return Array.isArray(sites) ? sites : [];
  },

  async setSites(sites: SiteConfig[]): Promise<void> {
    await writeValue(STORAGE_KEYS.sites, sites);
  },

  async getSessions(): Promise<Record<string, SiteSession>> {
    return readValue<Record<string, SiteSession>>(STORAGE_KEYS.sessions, {});
  },

  async setSessions(sessions: Record<string, SiteSession>): Promise<void> {
    await writeValue(STORAGE_KEYS.sessions, sessions);
  },

  async getSettings(): Promise<Settings> {
    return mergeSettings(await readValue<Partial<Settings>>(STORAGE_KEYS.settings, {}));
  },

  async setSettings(settings: Settings): Promise<void> {
    await writeValue(STORAGE_KEYS.settings, settings);
  },

  async getFlows(): Promise<Record<string, PersistedLoginFlow>> {
    return readValue<Record<string, PersistedLoginFlow>>(STORAGE_KEYS.flows, {});
  },

  async setFlows(flows: Record<string, PersistedLoginFlow>): Promise<void> {
    await writeValue(STORAGE_KEYS.flows, flows);
  },

  async getHistory(): Promise<string[]> {
    const history = await readValue<string[]>(STORAGE_KEYS.history, []);
    return Array.isArray(history) ? history.slice(0, 30) : [];
  },

  async setHistory(history: string[]): Promise<void> {
    await writeValue(STORAGE_KEYS.history, history.slice(0, 30));
  },

  async getVault(): Promise<Record<string, CookieVaultEntry>> {
    return readValue<Record<string, CookieVaultEntry>>(STORAGE_KEYS.vault, {});
  },

  async setVault(vault: Record<string, CookieVaultEntry>): Promise<void> {
    await writeValue(STORAGE_KEYS.vault, vault);
  },

  async getVaultKey(): Promise<string | null> {
    return readValue<string | null>(STORAGE_KEYS.vaultKey, null);
  },

  async setVaultKey(key: string): Promise<void> {
    await writeValue(STORAGE_KEYS.vaultKey, key);
  },

  /** 组装面板初始化所需的完整快照。 */
  async getSnapshot(flows: Record<string, LoginFlowState>): Promise<AppSnapshot> {
    const [sites, sessions, settings, history] = await Promise.all([
      this.getSites(),
      this.getSessions(),
      this.getSettings(),
      this.getHistory(),
    ]);
    return { sites, sessions, settings, history, flows };
  },
};
