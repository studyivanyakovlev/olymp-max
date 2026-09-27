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
}

declare global {
  interface Window {
    WebApp?: MaxWebApp;
  }
}

export const bridge = () => window.WebApp;
export const initData = () => bridge()?.initData ?? '';
const inMax = () => Boolean(initData());

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
    return inMax()
      ? ((await bridge()?.DeviceStorage?.getItem(FILTER_KEY)) ??
          localStorage.getItem(FILTER_KEY))
      : localStorage.getItem(FILTER_KEY);
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
