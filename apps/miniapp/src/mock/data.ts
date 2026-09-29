import type { Olympiad, Profile, Subscription } from '../types';

// Вымышленные записи для проверки интерфейса. Это не подтвержденные сроки сезона 2026/27.
export const olympiads: Olympiad[] = [
  {
    id: 'demo-math',
    title: 'Демо-олимпиада по математике',
    organizer: 'Демонстрационный сценарий',
    subjects: ['Математика'],
    grade_from: 8,
    grade_to: 11,
    rsosh_level: null,
    format: 'online',
    benefits_note: 'Учебный пример: льготы не предоставляются.',
    description:
      'Проверьте, как работает подписка и напоминание в боте. Даты и этапы этой карточки демонстрационные.',
    url: 'https://max.ru/',
    source_url: 'https://max.ru/',
    verified_at: '2026-09-27',
    is_demo: true,
    stages: [
      {
        id: 'demo-reg',
        kind: 'registration',
        starts_at: '2026-09-28T09:00:00+03:00',
        ends_at: '2026-10-05T23:59:00+03:00',
        format: 'online',
      },
      {
        id: 'demo-qual',
        kind: 'qualifying',
        starts_at: '2026-10-09T10:00:00+03:00',
        format: 'online',
      },
    ],
  },
  {
    id: 'sample-physics',
    title: 'Физический вызов',
    organizer: 'Пример организатора',
    subjects: ['Физика'],
    grade_from: 9,
    grade_to: 11,
    rsosh_level: 1,
    format: 'online',
    benefits_note: 'Возможные льготы определяет вуз. Проверяйте правила приёма.',
    description: 'Пример карточки по физике для проверки интерфейса каталога.',
    url: 'https://example.org/physics',
    source_url: 'https://example.org/physics',
    verified_at: '2026-09-27',
    stages: [
      {
        id: 'phy-reg',
        kind: 'registration',
        starts_at: '2026-09-29T09:00:00+03:00',
        ends_at: '2026-10-18T23:59:00+03:00',
        format: 'online',
      },
      {
        id: 'phy-qual',
        kind: 'qualifying',
        starts_at: '2026-11-02T10:00:00+03:00',
        format: 'online',
      },
    ],
  },
  {
    id: 'sample-informatics',
    title: 'Алгоритмы будущего',
    organizer: 'Пример организатора',
    subjects: ['Информатика'],
    grade_from: 8,
    grade_to: 11,
    rsosh_level: 2,
    format: 'hybrid',
    benefits_note: 'Льготы зависят от правил конкретного вуза.',
    description: 'Пример карточки по информатике для проверки интерфейса каталога.',
    url: 'https://example.org/informatics',
    source_url: 'https://example.org/informatics',
    verified_at: '2026-09-27',
    stages: [
      {
        id: 'inf-reg',
        kind: 'registration',
        starts_at: '2026-10-01T09:00:00+03:00',
        ends_at: '2026-10-29T23:59:00+03:00',
        format: 'online',
      },
      {
        id: 'inf-qual',
        kind: 'qualifying',
        starts_at: '2026-11-15T10:00:00+03:00',
        format: 'hybrid',
      },
    ],
  },
  {
    id: 'sample-literature',
    title: 'Литературный маршрут',
    organizer: 'Пример организатора',
    subjects: ['Литература'],
    grade_from: 8,
    grade_to: 11,
    rsosh_level: 3,
    format: 'online',
    benefits_note: 'Условия льгот уточняйте в вузе.',
    description: 'Пример карточки по литературе для проверки интерфейса каталога.',
    url: 'https://example.org/literature',
    source_url: 'https://example.org/literature',
    verified_at: '2026-09-27',
    stages: [
      {
        id: 'lit-reg',
        kind: 'registration',
        starts_at: '2026-10-03T09:00:00+03:00',
        ends_at: '2026-11-12T23:59:00+03:00',
        format: 'online',
      },
      {
        id: 'lit-qual',
        kind: 'qualifying',
        starts_at: '2026-12-04T10:00:00+03:00',
        format: 'online',
      },
    ],
  },
  {
    id: 'sample-history',
    title: 'История в деталях',
    organizer: 'Пример организатора',
    subjects: ['История'],
    grade_from: 9,
    grade_to: 11,
    rsosh_level: 2,
    format: 'offline',
    benefits_note: 'Условия льгот уточняйте в вузе.',
    description: 'Пример очной олимпиады для проверки фильтров.',
    url: 'https://example.org/history',
    source_url: 'https://example.org/history',
    verified_at: '2026-09-27',
    stages: [
      {
        id: 'his-reg',
        kind: 'registration',
        starts_at: '2026-10-05T09:00:00+03:00',
        ends_at: '2026-11-22T23:59:00+03:00',
        format: 'offline',
      },
      {
        id: 'his-qual',
        kind: 'qualifying',
        starts_at: '2026-12-12T10:00:00+03:00',
        format: 'offline',
      },
    ],
  },
];

export let profile: Profile | null = {
  grade: 10,
  subjects: ['Математика', 'Физика', 'Информатика'],
  region_code: '77',
  timezone: 'Europe/Moscow',
  quiet_from: '21:00',
  quiet_to: '09:00',
};
export let subscriptions: Subscription[] = [
  { id: 'sub-physics', olympiad_id: 'sample-physics', status: 'interested' },
];
export function setProfile(value: Profile | null) {
  profile = value;
}
export function setSubscriptions(value: Subscription[]) {
  subscriptions = value;
}
