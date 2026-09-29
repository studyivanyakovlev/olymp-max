import { initData, getUserId } from './bridge';
import type {
  Filters,
  Olympiad,
  Profile,
  Subscription,
  SubscriptionStatus,
} from './types';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const userId = getUserId();
  const maxInit = initData();
  const tgInit = (window as any).Telegram?.WebApp?.initData || '';

  // Сервер узнаёт пользователя по подписанному initData. X-User-Id нужен только
  // для локальной разработки без MAX: боевой сервер его не принимает.
  const signed = Boolean(maxInit || tgInit);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(maxInit ? { 'X-Max-Init-Data': maxInit } : {}),
    ...(tgInit ? { 'X-Telegram-Init-Data': tgInit } : {}),
    ...(!signed && userId ? { 'X-User-Id': userId } : {}),
    ...((options.headers as any) || {}),
  };

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new Error('Сессия MAX истекла. Откройте приложение из бота снова.');
    throw new Error(
      `Не удалось загрузить данные (${response.status}). Попробуйте ещё раз.`,
    );
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

export const api = {
  olympiads(filters: Filters) {
    const query = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) query.set(key === 'subject' ? 'subject' : key, value);
    });
    return request<Olympiad[]>(`/olympiads?${query}`);
  },
  olympiad(id: string) {
    return request<Olympiad>(`/olympiads/${encodeURIComponent(id)}`);
  },
  profile() {
    return request<Profile>('/me');
  },
  updateProfile(profile: Profile) {
    return request<Profile>('/me', { method: 'PUT', body: JSON.stringify(profile) });
  },
  deleteProfile() {
    return request<void>('/me', { method: 'DELETE' });
  },
  subscriptions() {
    return request<Subscription[]>('/me/subscriptions');
  },
  subscribe(olympiad_id: string) {
    return request<Subscription>('/me/subscriptions', {
      method: 'POST',
      body: JSON.stringify({ olympiad_id }),
    });
  },
  updateSubscription(id: string, status: SubscriptionStatus) {
    return request<Subscription>(`/me/subscriptions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },
};
