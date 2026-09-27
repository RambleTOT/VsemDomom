import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signInitData, verifyInitData } from '../src/auth/init-data.ts';
import { authenticate } from '../src/auth/principal.ts';
import { issueSession, verifySession } from '../src/auth/session.ts';
import { LOCAL_CHECKER_TOKENS, LOCAL_SESSION_SECRET, loadConfig } from '../src/config/env.ts';
import { CHECKER_USERS } from '../src/config/params.ts';
import { parseIfMatch, assertVersion } from '../src/http/if-match.ts';
import { ApiError } from '../src/http/problem.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findUp } from '../src/util/paths.ts';

// Тестовый токен — не секрет: подписи строятся здесь же.
const BOT_TOKEN = 'local-only-test-bot-token';
const now = new Date('2026-09-27T12:00:00Z');
const authDate = Math.floor(now.getTime() / 1000) - 120;
const options = { maxAgeSec: 3600, clockSkewSec: 60 };

/** initData как в window.WebApp.initData: значения закодированы encodeURIComponent, hash — по алгоритму MAX. */
function initData(fields: Record<string, string>, token = BOT_TOKEN, tamper?: (raw: string) => string): string {
  const hash = signInitData(new Map(Object.entries(fields)), token);
  const raw = [...Object.entries(fields), ['hash', hash]].map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join('&');
  return tamper ? tamper(raw) : raw;
}

const user = JSON.stringify({ id: 67890, first_name: 'Max', last_name: 'User', username: null, language_code: 'ru', photo_url: null });
const chat = JSON.stringify({ id: 12345, type: 'DIALOG' });
const base = { auth_date: String(authDate), chat, ip: '192.168.0.1', query_id: '4c0ab423-342b-4e45-aea4-2747dbc500cd', user };

describe('initData MAX (dev.max.ru/docs/webapps/validation)', () => {
  it('подпись: HMAC-SHA256(secret_key, launch_params), secret_key = HMAC-SHA256("WebAppData", токен), ключи по алфавиту через \\n', () => {
    const launch = [
      `auth_date=${authDate}`,
      `chat=${chat}`,
      'ip=192.168.0.1',
      'query_id=4c0ab423-342b-4e45-aea4-2747dbc500cd',
      `user=${user}`,
    ].join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    expect(signInitData(new Map(Object.entries(base)), BOT_TOKEN)).toBe(createHmac('sha256', secret).update(launch).digest('hex'));
  });

  it('верные данные: пользователь, чат, start_param; имя и фамилия дальше не передаются', () => {
    const result = verifyInitData(initData({ ...base, start_param: 'i_K3f9QpZ2aB' }), BOT_TOKEN, now, options);
    expect(result).toEqual({
      ok: true,
      data: { user: { id: 67890, languageCode: 'ru' }, chat: { id: 12345, type: 'DIALOG' }, startParam: 'i_K3f9QpZ2aB', authDate: new Date(authDate * 1000) },
    });
    expect(JSON.stringify(result)).not.toContain('Max');
  });

  it('значения декодируются decodeURIComponent: «+» остаётся плюсом', () => {
    const withPlus = { ...base, query_id: 'a+b c' };
    expect(verifyInitData(initData(withPlus), BOT_TOKEN, now, options).ok).toBe(true);
  });

  it('отклоняет подмену, чужой токен, повтор ключа, отсутствие подписи и пользователя', () => {
    const cases: [string, string][] = [
      [initData(base, BOT_TOKEN, (raw) => raw.replace('67890', '67891')), 'bad_signature'],
      [initData(base, 'local-only-other-token'), 'bad_signature'],
      [initData(base, BOT_TOKEN, (raw) => `${raw}&ip=1.1.1.1`), 'duplicate_key'],
      [initData(base, BOT_TOKEN, (raw) => `${raw}&hash=00`), 'duplicate_key'],
      [initData(base, BOT_TOKEN, (raw) => raw.replace(/&hash=[0-9a-f]+/, '')), 'no_hash'],
      ['hash', 'malformed'],
      [initData({ auth_date: String(authDate) }), 'no_user'],
    ];
    for (const [raw, error] of cases) expect(verifyInitData(raw, BOT_TOKEN, now, options), error).toEqual({ ok: false, error });
  });

  it('auth_date: не старше часа (+60 с на расхождение часов), не из будущего', () => {
    const old = { ...base, auth_date: String(authDate - 3600 - 61 + 120) };
    expect(verifyInitData(initData(old), BOT_TOKEN, now, options)).toEqual({ ok: false, error: 'expired' });
    const edge = { ...base, auth_date: String(Math.floor(now.getTime() / 1000) - 3600 - 30) };
    expect(verifyInitData(initData(edge), BOT_TOKEN, now, options).ok).toBe(true);
    const future = { ...base, auth_date: String(Math.floor(now.getTime() / 1000) + 300) };
    expect(verifyInitData(initData(future), BOT_TOKEN, now, options)).toEqual({ ok: false, error: 'expired' });
  });

  it('start_param вне формата не передаётся дальше', () => {
    const result = verifyInitData(initData({ ...base, start_param: 'i_<script>' }), BOT_TOKEN, now, options);
    expect(result.ok && result.data.startParam).toBeNull();
  });
});

describe('сессия JWT', () => {
  const secret = LOCAL_SESSION_SECRET;

  it('12 часов; после — «истекла»; чужой секрет — «неверна»', async () => {
    const { token, expiresAt } = await issueSession(secret, { userId: 67890, dev: false }, now);
    expect(expiresAt).toEqual(new Date('2026-09-28T00:00:00Z'));
    expect(await verifySession(secret, token, new Date('2026-09-27T23:59:00Z'))).toEqual({ ok: true, claims: { userId: 67890, dev: false } });
    expect(await verifySession(secret, token, new Date('2026-09-28T00:00:01Z'))).toEqual({ ok: false, reason: 'expired' });
    expect(await verifySession('local-only-another-secret-0123456789abcdef', token, now)).toEqual({ ok: false, reason: 'invalid' });
    expect(await verifySession(secret, `${token}x`, now)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('Bearer: сессия, checker-токен (только при CHECKER_API_ENABLED), ошибки', async () => {
    const config = loadConfig({
      DATABASE_URL: 'x',
      SESSION_SECRET: secret,
      CHECKER_API_ENABLED: 'true',
      CHECKER_TOKEN_RESIDENT: LOCAL_CHECKER_TOKENS[0],
      CHECKER_TOKEN_UK: LOCAL_CHECKER_TOKENS[2],
    });
    const { token } = await issueSession(secret, { userId: 5, dev: true }, now);
    expect(await authenticate(config, `Bearer ${token}`, now)).toEqual({ principal: { kind: 'session', userId: 5, dev: true } });
    expect(await authenticate(config, `Bearer ${LOCAL_CHECKER_TOKENS[2]}`, now)).toEqual({
      principal: { kind: 'checker', userId: CHECKER_USERS.uk, role: 'uk' },
    });
    expect(await authenticate(config, undefined, now)).toEqual({ principal: null, problem: 'missing' });
    expect(await authenticate(config, 'Basic abc', now)).toEqual({ principal: null, problem: 'invalid' });
    const off = { ...config, checker: { ...config.checker, enabled: false } };
    expect(await authenticate(off, `Bearer ${LOCAL_CHECKER_TOKENS[0]}`, now)).toEqual({ principal: null, problem: 'invalid' });
  });

  it('ID пользователей проверяющих совпадают с seeds/checker.json', () => {
    const root = findUp('pnpm-workspace.yaml')!.replace(/pnpm-workspace\.yaml$/, '');
    const seeds = JSON.parse(readFileSync(join(root, 'seeds/checker.json'), 'utf8')) as { users: { name: string; maxUserId: number }[] };
    expect(Object.fromEntries(seeds.users.map((u) => [u.name, u.maxUserId]))).toEqual(CHECKER_USERS);
  });
});

describe('If-Match', () => {
  it('версия числом или в кавычках; нет заголовка — последнее изменение выигрывает', () => {
    expect(parseIfMatch(undefined)).toBeNull();
    expect(parseIfMatch('*')).toBeNull();
    expect(parseIfMatch('5')).toBe(5);
    expect(parseIfMatch('"7"')).toBe(7);
    expect(parseIfMatch('W/"8"')).toBe(8);
    expect(() => parseIfMatch('abc')).toThrow(ApiError);
    expect(() => assertVersion(3, 4)).toThrow(expect.objectContaining({ status: 409, code: 'version_conflict', extra: { currentVersion: 4 } }));
    expect(() => assertVersion(null, 4)).not.toThrow();
  });
});
