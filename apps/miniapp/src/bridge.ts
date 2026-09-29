interface MaxWebApp {
  initData?: string;
  initDataUnsafe?: { start_param?: string };
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(callback: () => void): void;
    offClick(callback: () => void): void;
  };
  HapticFeedback?: { notificationOccurred(kind: 'success' | 'error' | 'warning'): void };
  DeviceStorage?: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<unknown>;
  };
  openLink?(url: string): void;
  shareMaxContent?(params: { text?: string; link?: string }): void;
  ready?(): void;
  expand?(): void;
}

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

export const bridge = () => window.WebApp;
export const initData = () => bridge()?.initData ?? '';

// На ПК и в веб-версии MAX WebApp.initData появляется не сразу после загрузки страницы:
// первые запросы уходили без подписи и получали 401. Ждём подпись один раз, не дольше 3 секунд.
let initDataWait: Promise<string> | null = null;
export function waitForInitData(timeoutMs = 3000): Promise<string> {
  if (!initDataWait) {
    initDataWait = new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        const value = initData();
        if (value || !bridge() || Date.now() - started >= timeoutMs) resolve(value);
        else setTimeout(check, 100);
      };
      check();
    });
  }
  return initDataWait;
}
const inMax = () => Boolean(initData());

export function getUserId(): string {
  try {
    const urlParam =
      new URLSearchParams(window.location.search).get('user_id') ||
      new URLSearchParams(window.location.search).get('userId');
    if (urlParam) {
      localStorage.setItem('olymp_user_id', urlParam);
      return urlParam;
    }
  } catch {}

  try {
    const maxUser = (window as any).WebApp?.initDataUnsafe?.user?.id;
    if (maxUser) {
      const s = String(maxUser);
      localStorage.setItem('olymp_user_id', s);
      return s;
    }
  } catch {}

  try {
    const cached = localStorage.getItem('olymp_user_id');
    if (cached) return cached;
  } catch {}

  return '';
}

export function startOlympiadId() {
  const value =
    bridge()?.initDataUnsafe?.start_param ??
    new URLSearchParams(location.search).get('startapp') ??
    '';
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : null;
}

export function openExternal(url: string) {
  if (!/^https:\/\//i.test(url)) return;
  if (inMax() && bridge()?.openLink) bridge()!.openLink!(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

export function shareOlympiad(id: string, title: string) {
  const bot = import.meta.env.VITE_BOT_NAME;
  const link = bot
    ? `https://max.ru/${bot}?startapp=${encodeURIComponent(id)}`
    : `${location.origin}/olympiads/${encodeURIComponent(id)}`;
  if (inMax() && bridge()?.shareMaxContent)
    bridge()!.shareMaxContent!({ text: `Посмотри олимпиаду «${title}»`, link });
  else if (navigator.share) void navigator.share({ title, url: link });
  else void navigator.clipboard?.writeText(link);
}

const FILTER_KEY = 'olymp-filters-v1';
export async function loadFilters(): Promise<string | null> {
  try {
    if (inMax() && bridge()?.DeviceStorage) {
      const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 400));
      const fetchPromise = bridge()!.DeviceStorage!.getItem(FILTER_KEY).then((raw: any) => {
        if (!raw) return null;
        if (typeof raw === 'object' && 'value' in raw) return raw.value;
        return typeof raw === 'string' ? raw : null;
      });
      const res = await Promise.race([fetchPromise, timeoutPromise]);
      if (res) return res;
    }
    return localStorage.getItem(FILTER_KEY);
  } catch {
    return localStorage.getItem(FILTER_KEY);
  }
}
export async function saveFilters(value: string) {
  try {
    localStorage.setItem(FILTER_KEY, value);
    if (inMax()) await bridge()?.DeviceStorage?.setItem(FILTER_KEY, value);
  } catch {
    /* Фильтры остаются доступными в текущем сеансе. */
  }
}
