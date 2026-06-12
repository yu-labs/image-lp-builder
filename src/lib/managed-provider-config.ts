export interface ProviderLink {
  visible: boolean;
  label: string;
  url: string;
}

export interface ManagedAdminCta {
  visible: boolean;
  eyebrow?: string;
  badge?: string;
  text: string;
  url: string;
}

export interface ManagedProviderConfig {
  providerLink: ProviderLink;
  managedAdminCta: ManagedAdminCta;
}

interface RemoteConfigShape {
  providerLink?: Partial<ProviderLink>;
  managedAdminCta?: Partial<ManagedAdminCta>;
}

export function isValidManagedProviderUrl(url: string | null | undefined): url is string {
  if (!url || !url.startsWith('https://')) return false;
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

const REMOTE_CACHE_TTL_MS = 60 * 60 * 1000;

interface RemoteConfigCache {
  url: string;
  cachedAt: number;
  data: RemoteConfigShape;
}

let remoteConfigCache: RemoteConfigCache | null = null;

async function fetchRemoteConfig(url: string): Promise<RemoteConfigShape> {
  if (
    remoteConfigCache &&
    remoteConfigCache.url === url &&
    Date.now() - remoteConfigCache.cachedAt < REMOTE_CACHE_TTL_MS
  ) {
    return remoteConfigCache.data;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return {};
    const json = (await res.json()) as unknown;
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return {};
    const data = parseRemoteConfig(json as Record<string, unknown>);
    remoteConfigCache = { url, cachedAt: Date.now(), data };
    return data;
  } catch {
    return {};
  }
}

function parseRemoteConfig(raw: Record<string, unknown>): RemoteConfigShape {
  const result: RemoteConfigShape = {};

  if (typeof raw.providerLink === 'object' && raw.providerLink !== null && !Array.isArray(raw.providerLink)) {
    const pl = raw.providerLink as Record<string, unknown>;
    const parsed: Partial<ProviderLink> = {};
    if (typeof pl.visible === 'boolean') parsed.visible = pl.visible;
    if (typeof pl.label === 'string') parsed.label = pl.label;
    if (typeof pl.url === 'string') parsed.url = pl.url;
    result.providerLink = parsed;
  }

  if (typeof raw.managedAdminCta === 'object' && raw.managedAdminCta !== null && !Array.isArray(raw.managedAdminCta)) {
    const cta = raw.managedAdminCta as Record<string, unknown>;
    const parsed: Partial<ManagedAdminCta> = {};
    if (typeof cta.visible === 'boolean') parsed.visible = cta.visible;
    if (typeof cta.eyebrow === 'string') parsed.eyebrow = cta.eyebrow;
    if (typeof cta.badge === 'string') parsed.badge = cta.badge;
    if (typeof cta.text === 'string') parsed.text = cta.text;
    if (typeof cta.url === 'string') parsed.url = cta.url;
    result.managedAdminCta = parsed;
  }

  return result;
}

export interface ManagedProviderEnv {
  configUrl?: string;
}

export async function resolveManagedProviderConfig(
  envInput: ManagedProviderEnv
): Promise<ManagedProviderConfig> {
  const defaults: ManagedProviderConfig = {
    providerLink: {
      visible: true,
      label: 'yulab',
      url: '',
    },
    managedAdminCta: {
      visible: true,
      eyebrow: 'AI画像LPの作り方・改善を',
      badge: 'LINE',
      text: '無料で相談する',
      url: '',
    },
  };

  let remote: RemoteConfigShape = {};
  if (isValidManagedProviderUrl(envInput.configUrl)) {
    remote = await fetchRemoteConfig(envInput.configUrl);
  }

  const providerLink: ProviderLink = {
    ...defaults.providerLink,
    ...remote.providerLink,
  };

  const managedAdminCta: ManagedAdminCta = {
    ...defaults.managedAdminCta,
    ...remote.managedAdminCta,
  };

  // Keep the provider surfaces visible by default. Missing URLs render as
  // non-clickable placeholders until a managed config supplies HTTPS links.
  if (!isValidManagedProviderUrl(providerLink.url)) {
    providerLink.url = '';
  }
  if (!isValidManagedProviderUrl(managedAdminCta.url)) {
    managedAdminCta.url = '';
  }

  return { providerLink, managedAdminCta };
}
