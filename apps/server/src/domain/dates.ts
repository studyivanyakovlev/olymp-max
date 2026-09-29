// Даты для текстов бота. По умолчанию показываем московское время: все даты датасета указаны по МСК.
const DEFAULT_TZ = 'Europe/Moscow';

function parts(date: Date | string, timeZone: string) {
  const fmt = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const map: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(date))) map[p.type] = p.value;
  return { day: map.day, month: map.month, year: map.year, time: `${map.hour}:${map.minute}` };
}

function currentYear(timeZone: string): string {
  return parts(new Date(), timeZone).year;
}

/** «10 октября», для другого года — «5 марта 2027» */
export function formatDay(date: Date | string, timeZone: string = DEFAULT_TZ): string {
  const p = parts(date, timeZone);
  return p.year === currentYear(timeZone) ? `${p.day} ${p.month}` : `${p.day} ${p.month} ${p.year}`;
}

/** «10 октября, 23:59 (МСК)» */
export function formatDeadline(date: Date | string, timeZone: string = DEFAULT_TZ): string {
  const suffix = timeZone === DEFAULT_TZ ? ' (МСК)' : '';
  return `${formatDay(date, timeZone)}, ${parts(date, timeZone).time}${suffix}`;
}

/** «11 октября», «24–25 октября», «30 октября – 2 ноября» */
export function formatRange(start: Date | string, end: Date | string, timeZone: string = DEFAULT_TZ): string {
  const a = parts(start, timeZone);
  const b = parts(end, timeZone);
  if (a.day === b.day && a.month === b.month && a.year === b.year) return formatDay(start, timeZone);
  if (a.month === b.month && a.year === b.year) {
    const year = a.year === currentYear(timeZone) ? '' : ` ${a.year}`;
    return `${a.day}–${b.day} ${b.month}${year}`;
  }
  return `${formatDay(start, timeZone)} – ${formatDay(end, timeZone)}`;
}
