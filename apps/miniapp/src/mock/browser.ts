import { http, HttpResponse } from 'msw';
import { setupWorker } from 'msw/browser';
import { olympiads, profile, setProfile, setSubscriptions, subscriptions } from './data';
import type { Filters, Profile, SubscriptionStatus } from '../types';

const handlers = [
  http.get('/api/olympiads', ({ request }) => {
    const search = new URL(request.url).searchParams;
    const filters = Object.fromEntries(search) as unknown as Filters;
    return HttpResponse.json(
      olympiads.filter(
        (item) =>
          (!filters.subject || item.subjects.includes(filters.subject)) &&
          (!filters.grade ||
            (+filters.grade >= item.grade_from && +filters.grade <= item.grade_to)) &&
          (!filters.level || String(item.rsosh_level) === filters.level) &&
          (!filters.format || item.format === filters.format),
      ),
    );
  }),
  http.get('/api/olympiads/:id', ({ params }) => {
    const item = olympiads.find((olympiad) => olympiad.id === params.id);
    return item ? HttpResponse.json(item) : new HttpResponse(null, { status: 404 });
  }),
  http.get('/api/me', () =>
    profile ? HttpResponse.json(profile) : new HttpResponse(null, { status: 404 }),
  ),
  http.put('/api/me', async ({ request }) => {
    const value = (await request.json()) as Profile;
    setProfile(value);
    return HttpResponse.json(value);
  }),
  http.delete('/api/me', () => {
    setSubscriptions([]);
    setProfile(null);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('/api/me/subscriptions', () => HttpResponse.json(subscriptions)),
  http.post('/api/me/subscriptions', async ({ request }) => {
    const { olympiad_id } = (await request.json()) as { olympiad_id: string };
    if (!olympiads.some((item) => item.id === olympiad_id))
      return new HttpResponse(null, { status: 404 });
    const existing = subscriptions.find(
      (item) => item.olympiad_id === olympiad_id && item.status !== 'dropped',
    );
    if (existing) return HttpResponse.json(existing);
    const item = { id: `sub-${olympiad_id}`, olympiad_id, status: 'interested' as const };
    setSubscriptions([
      ...subscriptions.filter((sub) => sub.olympiad_id !== olympiad_id),
      item,
    ]);
    return HttpResponse.json(item);
  }),
  http.patch('/api/me/subscriptions/:id', async ({ params, request }) => {
    const { status } = (await request.json()) as { status: SubscriptionStatus };
    const item = subscriptions.find((sub) => sub.id === params.id);
    if (!item) return new HttpResponse(null, { status: 404 });
    const updated = { ...item, status };
    setSubscriptions(subscriptions.map((sub) => (sub.id === item.id ? updated : sub)));
    return HttpResponse.json(updated);
  }),
];

export const worker = setupWorker(...handlers);
