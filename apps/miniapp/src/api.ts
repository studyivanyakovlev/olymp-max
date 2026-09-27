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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(maxInit ? { 'X-Max-Init-Data': maxInit } : {}),
    ...(tgInit ? { 'X-Telegram-Init-Data': tgInit } : {}),
    ...(userId ? { 'X-User-Id': userId } : {}),
    ...((options.headers as any) || {}),
  };

  let fullPath = `/api${path}`;
  if (userId && !fullPath.includes('user_id=')) {
    const sep = fullPath.includes('?') ? '&' : '?';
    fullPath += `${sep}user_id=${encodeURIComponent(userId)}`;
  }

  const response = await fetch(fullPath, {
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
