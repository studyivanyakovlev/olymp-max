import { useEffect, useMemo, useState } from 'react';
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
  useLocation,
} from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  Filter,
  GraduationCap,
  MapPin,
  Search,
  Settings2,
  Share2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { api } from './api';
import {
  bridge,
  loadFilters,
  openExternal,
  saveFilters,
  shareOlympiad,
  startOlympiadId,
} from './bridge';
import type {
  Filters,
  Olympiad,
  Profile,
  Stage,
  Subscription,
  SubscriptionStatus,
} from './types';

const subjects = [
  'Математика',
  'Физика',
  'Информатика',
  'Русский язык',
  'Литература',
  'История',
  'Химия',
  'Биология',
  'Английский язык',
];
const initialFilters: Filters = { subject: '', grade: '', level: '', format: '' };
const formatName: Record<string, string> = {
  online: 'Онлайн',
  offline: 'Очно',
  hybrid: 'Смешанный',
};
const stageName: Record<string, string> = {
  registration: 'Регистрация',
  qualifying: 'Отборочный тур',
  final: 'Финал',
  results: 'Результаты',
};

function dateText(
  value: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' },
) {
  return new Intl.DateTimeFormat('ru-RU', {
    ...options,
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}
function deadline(item: Olympiad) {
  return item.stages.find((stage) => stage.kind === 'registration')?.ends_at;
}
function daysLeft(value?: string | null) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / 86400000);
}
function olympiadCount(value: number) {
  const tail = value % 100;
  if (tail >= 11 && tail <= 14) return `${value} олимпиад`;
  if (value % 10 === 1) return `${value} олимпиада`;
  if ([2, 3, 4].includes(value % 10)) return `${value} олимпиады`;
  return `${value} олимпиад`;
}
function DeadlineTag({ value }: { value?: string | null }) {
  const days = daysLeft(value);
  if (days === null) return null;
  return (
    <span className={`deadline-tag ${days >= 0 && days <= 3 ? 'urgent' : ''}`}>
      <Clock3 size={13} />
      {days < 0
        ? 'Регистрация завершена'
        : days === 0
          ? 'Закрывается сегодня'
          : `До ${dateText(value!)}`}
    </span>
  );
}

type LoadState<T> = { data: T | null; loading: boolean; error: string };
function useLoad<T>(
  loader: () => Promise<T>,
  deps: unknown[],
): [LoadState<T>, () => void] {
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<LoadState<T>>({
    data: null,
    loading: true,
    error: '',
  });
  useEffect(() => {
    let active = true;
    setState((previous) => ({ ...previous, loading: true, error: '' }));
    loader()
      .then((data) => {
        if (active) setState({ data, loading: false, error: '' });
      })
      .catch((error) => {
        if (active)
          setState({
            data: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Что-то пошло не так.',
          });
      });
    return () => {
      active = false;
    };
    // Зависимости передает экран, который выполняет запрос.
  }, [...deps, version]);
  return [state, () => setVersion((value) => value + 1)];
}

function ViewState({
  state,
  retry,
  empty,
  children,
}: {
  state: LoadState<unknown>;
  retry: () => void;
  empty?: boolean;
  children: React.ReactNode;
}) {
  if (state.loading)
    return (
      <div className="state-card" role="status">
        <div className="loader" />
        <h3>Загружаем данные</h3>
        <p>Это займёт несколько секунд.</p>
      </div>
    );
  if (state.error)
    return (
      <div className="state-card" role="alert">
        <span className="state-icon">
          <X size={24} />
        </span>
        <h3>Не удалось открыть раздел</h3>
        <p>{state.error}</p>
        <button className="primary-btn" onClick={retry}>
          Повторить
        </button>
      </div>
    );
  if (empty)
    return (
      <div className="state-card">
        <span className="state-icon">
          <Search size={24} />
        </span>
        <h3>Пока ничего нет</h3>
        <p>Попробуйте изменить фильтры или загляните позже.</p>
      </div>
    );
  return <>{children}</>;
}

function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      <NavLink to="/" end>
        <Search size={21} />
        <span>Каталог</span>
      </NavLink>
      <NavLink to="/season">
        <CalendarDays size={21} />
        <span>Мой сезон</span>
      </NavLink>
      <NavLink to="/settings">
        <Settings2 size={21} />
        <span>Настройки</span>
      </NavLink>
    </nav>
  );
}

function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    // 1. Немедленно сохраняем идентификатор пользователя из query параметров (user_id или userId)
    try {
      const searchParams = new URLSearchParams(location.search);
      const uid = searchParams.get('user_id') || searchParams.get('userId');
      if (uid) {
        localStorage.setItem('olymp_user_id', uid);
      }
    } catch {}

    // 2. Если приложение открыто по адресу /app или /miniapp, перенаправляем на / с сохранением query
    if (location.pathname === '/app' || location.pathname === '/miniapp') {
      navigate('/' + location.search, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    const backButton = bridge()?.initData ? bridge()?.BackButton : undefined;
    if (!backButton) return;
    const goBack = () => navigate('/');
    const shouldShow =
      location.pathname !== '/' &&
      location.pathname !== '/app' &&
      location.pathname !== '/miniapp';
    if (shouldShow) {
      backButton.show();
      backButton.onClick(goBack);
    } else {
      backButton.hide();
    }
    return () => {
      if (shouldShow) backButton.offClick(goBack);
    };
  }, [location.pathname, navigate]);

  useEffect(() => {
    const start = startOlympiadId();
    if (start && (location.pathname === '/' || location.pathname === '/app'))
      navigate(`/olympiads/${start}`, { replace: true });
  }, []); // Параметр запуска обрабатывается один раз.

  return (
    <div className="app-shell">
      <div className="desktop-rail">
        <div className="brand-lockup">
          <span className="brand-mark">
            <Sparkles size={20} />
          </span>
          <span className="brand-name">Олимпиадный навигатор</span>
        </div>
        <p>
          Ваш спокойный путь
          <br />к олимпиадам
        </p>
        <BottomNav />
        <div className="rail-note">
          Все важные даты
          <br />в одном месте
        </div>
      </div>
      <div className="app-main">
        <Routes>
          <Route path="/" element={<Catalog />} />
          <Route path="/app" element={<Catalog />} />
          <Route path="/miniapp" element={<Catalog />} />
          <Route path="/olympiads/:id" element={<OlympiadDetail />} />
          <Route path="/app/olympiads/:id" element={<OlympiadDetail />} />
          <Route path="/season" element={<Season />} />
          <Route path="/app/season" element={<Season />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/app/settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <div className="mobile-nav">
          <BottomNav />
        </div>
      </div>
    </div>
  );
}

function Catalog() {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [filtersReady, setFiltersReady] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tab, setTab] = useState<'recommended' | 'all'>('recommended');

  useEffect(() => {
    // Синхронизация с профилем из бота
    api
      .profile()
      .then((p) => {
        if (p) {
          setProfile(p);
        }
      })
      .catch(() => {});

    void loadFilters().then((value) => {
      if (value) {
        try {
          const parsed = JSON.parse(value);
          setFilters({ ...initialFilters, ...parsed });
          if (parsed.tab) setTab(parsed.tab);
        } catch {
          /* Используем фильтры по умолчанию. */
        }
      }
      setFiltersReady(true);
    });
  }, []);

  useEffect(() => {
    if (filtersReady) void saveFilters(JSON.stringify({ ...filters, tab }));
  }, [filters, tab, filtersReady]);

  const [state, retry] = useLoad(
    () => api.olympiads(filters),
    [filters.subject, filters.grade, filters.level, filters.format, filtersReady],
  );

  const list = useMemo(() => {
    let items = state.data ?? [];

    // В режиме «Моя подборка» отображаем олимпиады строго под класс и предметы из бота
    if (tab === 'recommended' && profile) {
      const uGrade = profile.grade;
      const uSubs = profile.subjects || [];

      items = items.filter((item) => {
        if (uGrade && (uGrade < item.grade_from || uGrade > item.grade_to)) {
          return false;
        }
        if (uSubs.length > 0) {
          const hasMatch = item.subjects.some(
            (s) =>
              uSubs.includes(s) ||
              uSubs.some(
                (us) =>
                  s.toLowerCase().includes(us.toLowerCase()) ||
                  us.toLowerCase().includes(s.toLowerCase()),
              ),
          );
          if (!hasMatch) return false;
        }
        return true;
      });
    }

    return items.filter((item) =>
      `${item.title} ${item.organizer} ${item.subjects.join(' ')}`
        .toLocaleLowerCase('ru')
        .includes(search.toLocaleLowerCase('ru')),
    );
  }, [state.data, search, tab, profile]);

  const count = Object.values(filters).filter(Boolean).length;
  return (
    <main className="screen catalog-screen">
      <div className="topline">
        <div className="mobile-brand">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          <span className="brand-name">Олимпиадный навигатор</span>
        </div>
        <span className="topline-caption">Сезон 2026/27</span>
      </div>
      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="eyebrow-dot" />
            Твой сезон начинается здесь
          </span>
          <h1>
            Не пропусти
            <br />
            <em>свой шанс.</em>
          </h1>
          <p>Олимпиады, сроки и напоминания - собрали всё важное для тебя.</p>
          <a className="hero-link" href="#catalog-list">
            Смотреть олимпиады <ArrowRight size={17} />
          </a>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-art-card">
            <span className="art-small">БЛИЖАЙШИЙ ДЕДЛАЙН</span>
            <div className="art-number">
              03<span>дня</span>
            </div>
            <div className="art-progress">
              <i />
            </div>
            <span className="art-foot">Успеем подготовиться ✦</span>
          </div>
          <span className="hero-star star-one">✦</span>
          <span className="hero-star star-two">✳</span>
        </div>
      </header>
      <section className="content-section" id="catalog-list">
        <div className="section-title">
          <div>
            <span className="section-kicker">
              {tab === 'recommended' ? 'СИНХРОНИЗИРОВАНО С БОТОМ' : 'ВЫБИРАЙ И УЧАСТВУЙ'}
            </span>
            <h2>
              {tab === 'recommended' ? 'Персональная подборка' : 'Каталог олимпиад'}
            </h2>
            <p>
              {tab === 'recommended'
                ? profile?.grade
                  ? `Олимпиады для ${profile.grade} класса по твоим предметам из бота`
                  : 'Олимпиады под твой профиль'
                : 'Найди то, что подходит именно тебе'}
            </p>
          </div>
          <span className="count-pill">{olympiadCount(list.length)}</span>
        </div>

        {/* Быстрое переключение: Подборка из бота vs Полный каталог */}
        <div className="catalog-tabs">
          <button
            className={`catalog-tab ${tab === 'recommended' ? 'active' : ''}`}
            onClick={() => setTab('recommended')}
            type="button"
          >
            <span>🎯 Моя подборка</span>
            {profile?.grade && (
              <span className="catalog-tab-badge">{profile.grade} кл</span>
            )}
          </button>
          <button
            className={`catalog-tab ${tab === 'all' ? 'active' : ''}`}
            onClick={() => setTab('all')}
            type="button"
          >
            <span>🌐 Все олимпиады</span>
            <span className="catalog-tab-badge">{state.data?.length ?? 0}</span>
          </button>
        </div>

        <div className="search-row">
          <label className="search-box">
            <Search size={19} />
            <span className="sr-only">Поиск олимпиады</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Название, предмет или организатор"
            />
          </label>
          <button
            className={`filter-button ${count > 0 ? 'selected' : ''} ${filterOpen ? 'active' : ''}`}
            onClick={() => setFilterOpen((value) => !value)}
            aria-expanded={filterOpen}
            type="button"
          >
            <Filter size={18} />
            <span className="filter-button-text">Фильтры</span>
            {count > 0 && <b className="filter-badge">{count}</b>}
          </button>
        </div>
        {filterOpen && (
          <div className="filters-panel">
            <div className="filters-heading">
              <strong>Подобрать олимпиады</strong>
              <button
                onClick={() => {
                  setFilters(initialFilters);
                  setFilterOpen(false);
                }}
                className="text-button"
              >
                Сбросить
              </button>
            </div>
            <div className="filter-grid">
              <SelectField
                label="Предмет"
                value={filters.subject}
                onChange={(subject) => setFilters({ ...filters, subject })}
                options={subjects.map((value) => [value, value])}
                all="Все предметы"
              />
              <SelectField
                label="Класс"
                value={filters.grade}
                onChange={(grade) => setFilters({ ...filters, grade })}
                options={[8, 9, 10, 11].map((value) => [String(value), `${value} класс`])}
                all="Любой класс"
              />
              <SelectField
                label="Уровень РСОШ"
                value={filters.level}
                onChange={(level) => setFilters({ ...filters, level })}
                options={['1', '2', '3'].map((value) => [value, `${value} уровень`])}
                all="Любой уровень"
              />
              <SelectField
                label="Формат"
                value={filters.format}
                onChange={(format) => setFilters({ ...filters, format })}
                options={Object.entries(formatName)}
                all="Любой формат"
              />
            </div>
          </div>
        )}
        {(import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true') && (
          <div className="demo-notice">
            <Sparkles size={16} />
            <span>
              Демонстрационные карточки. Даты и названия приведены только для проверки
              интерфейса.
            </span>
          </div>
        )}
        <ViewState state={state} retry={retry} empty={!list.length}>
          {
            <div className="cards-grid">
              {list.map((item, index) => (
                <OlympiadCard key={item.id} item={item} index={index} />
              ))}
            </div>
          }
        </ViewState>
      </section>
      <footer className="screen-footer">
        Сроки могут меняться. Проверяй информацию на сайте организатора.
      </footer>
    </main>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
  all,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: string[][];
  all: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{all}</option>
        {options.map(([key, name]) => (
          <option value={key} key={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function OlympiadCard({ item, index }: { item: Olympiad; index: number }) {
  const navigate = useNavigate();
  const colors = ['peach', 'lavender', 'mint', 'blue'];
  return (
    <article
      className={`olympiad-card card-${colors[index % colors.length]}`}
      onClick={() => navigate(`/olympiads/${item.id}`)}
    >
      <div className="card-top">
        <span className="subject-icon">
          <BookOpen size={20} />
        </span>
        <div className="card-badges">
          {item.is_demo && <span className="badge demo">Демо</span>}
          {item.rsosh_level && (
            <span className="badge">РСОШ · {item.rsosh_level} ур.</span>
          )}
        </div>
      </div>
      <div className="card-body">
        <span className="card-subject">{item.subjects.join(' · ')}</span>
        <h3>{item.title}</h3>
        <p>{item.organizer}</p>
      </div>
      <div className="card-bottom">
        <DeadlineTag value={deadline(item)} />
        <button
          aria-label={`Открыть ${item.title}`}
          className="round-arrow"
          onClick={(event) => {
            event.stopPropagation();
            navigate(`/olympiads/${item.id}`);
          }}
        >
          <ArrowRight size={18} />
        </button>
      </div>
    </article>
  );
}

function OlympiadDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [state, retry] = useLoad(() => api.olympiad(id), [id]);
  const [subs, refreshSubs] = useLoad(() => api.subscriptions(), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const item = state.data;
  const subscription = subs.data?.find(
    (sub) => sub.olympiad_id === id && sub.status !== 'dropped',
  );
  async function subscribe() {
    if (!item || busy) return;
    setBusy(true);
    setMessage('');
    try {
      await api.subscribe(item.id);
      if (bridge()?.initData) bridge()?.HapticFeedback?.notificationOccurred('success');
      refreshSubs();
      setMessage('Подписка оформлена. Напомним о важных датах в боте MAX.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось подписаться.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="screen detail-screen">
      <button className="back-link" onClick={() => navigate('/')}>
        <ArrowLeft size={18} /> Назад к каталогу
      </button>
      <ViewState state={state} retry={retry}>
        {item && (
          <>
            <div className="detail-hero">
              <div className="detail-hero-top">
                <span className="subject-icon large">
                  <BookOpen size={26} />
                </span>
                <div>
                  {item.is_demo && <span className="badge demo">Демо-олимпиада</span>}
                  {item.rsosh_level && (
                    <span className="badge">РСОШ · {item.rsosh_level} уровень</span>
                  )}
                </div>
              </div>
              <span className="section-kicker">{item.subjects.join(' · ')}</span>
              <h1>{item.title}</h1>
              <p>{item.description || item.organizer}</p>
              <div className="detail-facts">
                <span>
                  <GraduationCap size={16} /> {item.grade_from}–{item.grade_to} классы
                </span>
                <span>
                  <MapPin size={16} /> {formatName[item.format]}
                </span>
                <DeadlineTag value={deadline(item)} />
              </div>
            </div>
            <div className="detail-layout">
              <div className="detail-content">
                <section className="detail-block">
                  <div className="block-heading">
                    <span className="block-icon">
                      <CalendarDays size={19} />
                    </span>
                    <div>
                      <span className="section-kicker">НЕ ПРОПУСТИ</span>
                      <h2>Этапы и сроки</h2>
                    </div>
                  </div>
                  <div className="timeline">
                    {item.stages.map((stage, index) => (
                      <StageRow key={stage.id} stage={stage} index={index} />
                    ))}
                  </div>
                </section>
                <section className="detail-block">
                  <div className="block-heading">
                    <span className="block-icon">
                      <GraduationCap size={19} />
                    </span>
                    <div>
                      <span className="section-kicker">ВАЖНО ЗНАТЬ</span>
                      <h2>О льготах</h2>
                    </div>
                  </div>
                  <p className="benefit-text">{item.benefits_note}</p>
                </section>
                <section className="source-block">
                  <ShieldCheck size={18} />
                  <div>
                    <strong>Проверяй информацию у организатора</strong>
                    <p>
                      Данные проверены{' '}
                      {dateText(item.verified_at, {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric',
                      })}{' '}
                      Даты могут измениться.
                    </p>
                    <button
                      className="inline-link"
                      onClick={() => openExternal(item.source_url)}
                    >
                      Перейти к источнику <ExternalLink size={14} />
                    </button>
                  </div>
                </section>
              </div>
              <aside className="action-panel">
                <div className="action-panel-head">
                  <Bell size={22} />
                  <h3>Сроки под контролем</h3>
                  <p>Подпишись - и мы напомним о регистрации и турах в MAX.</p>
                </div>
                <button
                  className="primary-btn full"
                  onClick={subscribe}
                  disabled={busy || !!subscription}
                >
                  {busy ? 'Подписываем…' : subscription ? 'Вы подписаны' : 'Подписаться'}
                </button>
                <button
                  className="secondary-btn full"
                  onClick={() => shareOlympiad(item.id, item.title)}
                >
                  <Share2 size={17} /> Поделиться с другом
                </button>
                <button
                  className="inline-link site-link"
                  onClick={() => openExternal(item.url)}
                >
                  Сайт олимпиады <ExternalLink size={15} />
                </button>
                {message && (
                  <p
                    className={`action-message ${subscription ? 'success' : ''}`}
                    role="status"
                  >
                    {message}
                  </p>
                )}
                {subs.error && (
                  <p className="action-message" role="alert">
                    Не удалось проверить подписку.{' '}
                    <button className="inline-link" onClick={refreshSubs}>
                      Повторить
                    </button>
                  </p>
                )}
              </aside>
            </div>
          </>
        )}
      </ViewState>
    </main>
  );
}

function StageRow({ stage, index }: { stage: Stage; index: number }) {
  return (
    <div className="timeline-row">
      <span className="timeline-number">{String(index + 1).padStart(2, '0')}</span>
      <div>
        <strong>{stageName[stage.kind]}</strong>
        <p>
          {dateText(stage.starts_at, { day: 'numeric', month: 'long', year: 'numeric' })}
          {stage.ends_at
            ? ` - ${dateText(stage.ends_at, { day: 'numeric', month: 'long', year: 'numeric' })}`
            : ''}
        </p>
      </div>
      <span className="timeline-format">
        {stage.format ? formatName[stage.format] : ''}
      </span>
    </div>
  );
}

function Season() {
  const [subState, refreshSubs] = useLoad(() => api.subscriptions(), []);
  const [catalogState, refreshCatalog] = useLoad(() => api.olympiads(initialFilters), []);
  const [busyId, setBusyId] = useState('');
  const [message, setMessage] = useState('');
  const [showAllEvents, setShowAllEvents] = useState(false);
  const navigate = useNavigate();
  const joined = useMemo(
    () =>
      (subState.data ?? [])
        .filter((sub) => sub.status !== 'dropped')
        .map((sub) => ({
          sub,
          item: catalogState.data?.find((item) => item.id === sub.olympiad_id),
        }))
        .filter((row) => row.item),
    [subState.data, catalogState.data],
  );
  const events = joined
    .flatMap(({ sub, item }) =>
      (item?.stages ?? [])
        .filter((stage) => sub.status !== 'registered' || stage.kind !== 'registration')
        .map((stage) => ({
          sub,
          item: item!,
          stage,
          date:
            stage.kind === 'registration'
              ? (stage.ends_at ?? stage.starts_at)
              : stage.starts_at,
        })),
    )
    .filter((event) => new Date(event.date).getTime() >= Date.now() - 86400000)
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const visibleEvents = showAllEvents ? events : events.slice(0, 6);
  const combined: LoadState<unknown> = {
    data: joined,
    loading: subState.loading || catalogState.loading,
    error: subState.error || catalogState.error,
  };
  async function update(sub: Subscription, status: SubscriptionStatus) {
    setBusyId(sub.id);
    setMessage('');
    try {
      await api.updateSubscription(sub.id, status);
      refreshSubs();
      setMessage(
        status === 'registered'
          ? 'Отлично! Напомним о следующих этапах.'
          : 'Подписка отключена.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось изменить статус.');
    } finally {
      setBusyId('');
    }
  }
  return (
    <main className="screen season-screen">
      <PageHeader
        eyebrow="ВСЁ ПОД КОНТРОЛЕМ"
        title="Мой сезон"
        description="Твои олимпиады и ближайшие важные даты."
      />
      <ViewState
        state={combined}
        retry={() => {
          refreshSubs();
          refreshCatalog();
        }}
        empty={!joined.length}
      >
        <div className="season-summary">
          <div className="summary-icon">
            <CalendarDays size={27} />
          </div>
          <div>
            <strong>{joined.length}</strong>
            <span>олимпиад в твоём сезоне</span>
          </div>
          <div>
            <strong>{events.length}</strong>
            <span>предстоящих событий</span>
          </div>
        </div>
        <div className="season-layout">
          <section>
            <div className="section-title compact">
              <div>
                <span className="section-kicker">ПО ПОРЯДКУ</span>
                <h2>Ближайшие даты</h2>
              </div>
            </div>
            {events.length ? (
              <div className="event-list">
                {visibleEvents.map(({ item, stage, date }) => (
                  <button
                    className="event-row"
                    key={`${item.id}-${stage.id}`}
                    onClick={() => navigate(`/olympiads/${item.id}`)}
                  >
                    <span className="event-date">
                      <b>{dateText(date, { day: '2-digit' })}</b>
                      <small>{dateText(date, { month: 'short' })}</small>
                    </span>
                    <span className="event-info">
                      <strong>
                        {stage.kind === 'registration'
                          ? 'Закрытие регистрации'
                          : stageName[stage.kind]}
                      </strong>
                      <small>{item.title}</small>
                    </span>
                    <ChevronRight size={19} />
                  </button>
                ))}
                {events.length > 6 && (
                  <button
                    className="event-more"
                    type="button"
                    onClick={() => setShowAllEvents((value) => !value)}
                  >
                    {showAllEvents
                      ? 'Свернуть список'
                      : `Показать все события (${events.length})`}
                  </button>
                )}
              </div>
            ) : (
              <div className="state-card small">
                <h3>Предстоящих дат пока нет</h3>
                <p>Следи за обновлениями в каталоге.</p>
              </div>
            )}
          </section>
          <section>
            <div className="section-title compact">
              <div>
                <span className="section-kicker">ТВОЙ СПИСОК</span>
                <h2>Мои олимпиады</h2>
              </div>
            </div>
            <div className="my-list">
              {joined.map(({ sub, item }) => (
                <div className="my-card" key={sub.id}>
                  <button
                    className="my-card-title"
                    onClick={() => navigate(`/olympiads/${item!.id}`)}
                  >
                    <span className="mini-subject-icon">
                      <BookOpen size={18} />
                    </span>
                    <span>
                      <strong>{item!.title}</strong>
                      <small className={sub.status === 'registered' ? 'registered' : ''}>
                        {sub.status === 'registered' && <Check size={12} />}
                        {sub.status === 'registered'
                          ? 'Зарегистрирован'
                          : 'Планирую участвовать'}
                      </small>
                    </span>
                    <ChevronRight size={18} />
                  </button>
                  <div className="my-card-actions">
                    {sub.status !== 'registered' && (
                      <button
                        className="status-button"
                        disabled={busyId === sub.id}
                        onClick={() => update(sub, 'registered')}
                      >
                        <Check size={15} /> Зарегистрировался
                      </button>
                    )}
                    <button
                      className="status-button muted"
                      disabled={busyId === sub.id}
                      onClick={() => update(sub, 'dropped')}
                    >
                      Не участвую
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
        {message && (
          <div className="toast" role="status">
            {message}
          </div>
        )}
      </ViewState>
    </main>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="page-header">
      <span className="section-kicker">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function Settings() {
  const navigate = useNavigate();
  const [state, retry] = useLoad(() => api.profile(), []);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    if (state.data) setDraft(state.data);
  }, [state.data]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage('');
    try {
      await api.updateProfile(draft);
      setMessage('Настройки сохранены! Подборка обновлена.');
      retry();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Не удалось сохранить настройки.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteData() {
    setBusy(true);
    setMessage('');
    try {
      await api.deleteProfile();
      setConfirmDelete(false);
      // Сбрасываем форму в дефолтное состояние, чтобы пользователь мог сразу изменить город/время/класс и сохранить
      const freshDraft: Profile = {
        grade: 10,
        region_code: '77',
        subjects: [],
        quiet_from: '22:00',
        quiet_to: '08:00',
        timezone: 'Europe/Moscow',
      };
      setDraft(freshDraft);
      setMessage(
        'Все данные удалены. Вы можете заново выбрать город, класс и время ниже и сохранить, либо вернуться в меню.',
      );
      retry();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось удалить данные.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen settings-screen">
      <button
        className="back-link"
        onClick={() => navigate('/')}
        type="button"
        style={{ marginBottom: 12 }}
      >
        <ArrowLeft size={18} /> Назад в меню
      </button>

      <PageHeader
        eyebrow="ПОД ТЕБЯ"
        title="Настройки"
        description="Управляй подборкой и временем напоминаний."
      />
      {deleted ? (
        <div className="state-card" role="status">
          <ShieldCheck size={28} />
          <h2>Данные удалены</h2>
          <p>Все ваши подписки и настройки были удалены.</p>
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 16,
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            <button
              className="primary-btn"
              onClick={() => {
                setDeleted(false);
                retry();
              }}
            >
              Настроить заново
            </button>
            <button className="secondary-btn" onClick={() => navigate('/')}>
              В главное меню
            </button>
          </div>
        </div>
      ) : (
        <ViewState state={state} retry={retry}>
          {draft && (
            <div className="settings-layout">
              <section className="settings-card">
                <div className="settings-card-head">
                  <span className="block-icon">
                    <GraduationCap size={20} />
                  </span>
                  <div>
                    <h2>Мой профиль</h2>
                    <p>Чтобы показывать подходящие олимпиады</p>
                  </div>
                </div>
                <div className="settings-fields">
                  <SelectField
                    label="Класс"
                    value={String(draft.grade)}
                    onChange={(grade) =>
                      setDraft({ ...draft, grade: Number(grade) || 10 })
                    }
                    options={[8, 9, 10, 11].map((value) => [
                      String(value),
                      `${value} класс`,
                    ])}
                    all="Выбери класс"
                  />
                  <label className="field">
                    <span>Регион</span>
                    <select
                      value={draft.region_code}
                      onChange={(event) =>
                        setDraft({ ...draft, region_code: event.target.value })
                      }
                    >
                      <option value="77">Москва</option>
                      <option value="78">Санкт-Петербург</option>
                      <option value="16">Татарстан</option>
                      <option value="50">Московская область</option>
                    </select>
                  </label>
                </div>
                <div className="field subject-field">
                  <span>Интересные предметы</span>
                  <div className="subject-chips">
                    {subjects.map((subject) => (
                      <button
                        className={`subject-chip ${draft.subjects.includes(subject) ? 'active' : ''}`}
                        key={subject}
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            subjects: draft.subjects.includes(subject)
                              ? draft.subjects.filter((value) => value !== subject)
                              : [...draft.subjects, subject],
                          })
                        }
                      >
                        {draft.subjects.includes(subject) && <Check size={14} />}
                        {subject}
                      </button>
                    ))}
                  </div>
                </div>
              </section>
              <section className="settings-card">
                <div className="settings-card-head">
                  <span className="block-icon">
                    <Bell size={20} />
                  </span>
                  <div>
                    <h2>Напоминания</h2>
                    <p>Выбери время, когда тебя не стоит беспокоить</p>
                  </div>
                </div>
                <div className="settings-fields">
                  <label className="field">
                    <span>Тихие часы с</span>
                    <input
                      type="time"
                      value={draft.quiet_from}
                      onChange={(event) =>
                        setDraft({ ...draft, quiet_from: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>До</span>
                    <input
                      type="time"
                      value={draft.quiet_to}
                      onChange={(event) =>
                        setDraft({ ...draft, quiet_to: event.target.value })
                      }
                    />
                  </label>
                </div>
                <p className="field-hint">
                  <Clock3 size={15} /> В это время сообщения не придут. Часовой пояс:{' '}
                  {draft.timezone}.
                </p>
              </section>
              {draft.subjects.length === 0 && (
                <p className="field-hint" style={{ marginTop: 0 }}>
                  <Sparkles size={15} /> Выберите предметы выше для точной подборки
                  олимпиад
                </p>
              )}
              <button
                className="primary-btn save-btn"
                disabled={busy}
                onClick={save}
                type="button"
              >
                {busy ? 'Сохраняем…' : 'Сохранить изменения'} <ArrowRight size={18} />
              </button>
              {message && (
                <p className="form-message" role="status">
                  {message}
                </p>
              )}
              <section className="privacy-card">
                <ShieldCheck size={20} />
                <div>
                  <h3>Твои данные - под контролем</h3>
                  <p>
                    Мы храним только идентификатор MAX, класс, предметы, регион и
                    настройки напоминаний.
                  </p>
                  <button
                    className="danger-link"
                    onClick={() => setConfirmDelete(true)}
                    type="button"
                  >
                    Удалить мои данные
                  </button>
                </div>
              </section>
              {confirmDelete && (
                <div className="dialog-backdrop">
                  <div
                    className="dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="delete-title"
                  >
                    <h2 id="delete-title">Удалить все данные?</h2>
                    <p>Профиль и подписки будут удалены. Это действие нельзя отменить.</p>
                    <div className="dialog-actions">
                      <button
                        className="secondary-btn"
                        onClick={() => setConfirmDelete(false)}
                        type="button"
                      >
                        Отмена
                      </button>
                      <button
                        className="danger-btn"
                        disabled={busy}
                        onClick={deleteData}
                        type="button"
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </ViewState>
      )}
    </main>
  );
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <main className="screen">
      <div className="state-card">
        <h1>Такой страницы нет</h1>
        <p>Вернись в каталог, чтобы найти олимпиаду.</p>
        <button className="primary-btn" onClick={() => navigate('/')}>
          В каталог
        </button>
      </div>
    </main>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
