import { describe, it, expect, afterEach } from 'vitest';
import { config } from '../src/config.js';
import { keyboards, setMiniAppBot } from '../src/bot/keyboards.js';

const openAppButtons = (kb: any) =>
  kb.payload.buttons.flat().filter((b: any) => b.type === 'open_app');

describe('11. Кнопки Mini App открывают мини-приложение нашего бота', () => {
  const demoToken = config.botToken;
  afterEach(() => {
    config.botToken = demoToken;
  });

  it('Боевой токен, ник бота ещё неизвестен: кнопки нет, остальные на месте', () => {
    config.botToken = 'real_bot_token';
    const kb = keyboards.olympiadCard('phystech-math', 'https://olymp-online.mipt.ru/');
    expect(openAppButtons(kb)).toEqual([]);
    expect(kb.payload.buttons.flat().some((b: any) => b.type === 'link')).toBe(true);
  });

  it('После GET /me кнопка ведёт к боту по нику и передаёт ID олимпиады', () => {
    config.botToken = 'real_bot_token';
    setMiniAppBot({ username: 'olymp_navigator_bot', user_id: 42 });
    const [button] = openAppButtons(keyboards.olympiadCard('phystech-math', 'https://olymp-online.mipt.ru/'));
    expect(button).toMatchObject({ web_app: 'olymp_navigator_bot', payload: 'phystech-math' });
    const [menuButton] = openAppButtons(keyboards.mainMenu());
    expect(menuButton.web_app).toBe('olymp_navigator_bot');
  });
});
