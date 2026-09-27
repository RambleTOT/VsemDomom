/**
 * Проверка initData мини-приложения — строго по алгоритму dev.max.ru/docs/webapps/validation:
 * пары key=value через «&» (делим по первому «=»), каждый параметр ровно один раз, hash — ровно один раз;
 * значения — decodeURIComponent; без hash, по ключам a → z, склейка «key=value» через «\n»;
 * secret_key = HMAC-SHA256(key="WebAppData", data=BOT_TOKEN); hash = hex(HMAC-SHA256(secret_key, launch_params)).
 * Сравнение — за постоянное время; auth_date (секунды) не старше maxAgeSec с допуском на расхождение часов.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface InitDataUser {
  id: number;
  /** Язык интерфейса MAX. Имя, фамилия, username и фото не сохраняются и дальше не передаются. */
  languageCode: string | null;
}

export interface VerifiedInitData {
  user: InitDataUser;
  /** Откуда открыто мини-приложение: подсказка для выбора дома, не доказательство. */
  chat: { id: number; type: string } | null;
  startParam: string | null;
  authDate: Date;
}

export type InitDataError = 'malformed' | 'duplicate_key' | 'no_hash' | 'bad_signature' | 'expired' | 'no_user';

const HEX_HASH = /^[0-9a-f]{64}$/;
const START_PARAM = /^[A-Za-z0-9_-]{1,512}$/;
const MS_PER_SECOND = 1000;

function parsePairs(raw: string): Map<string, string> | 'malformed' | 'duplicate_key' {
  const pairs = new Map<string, string>();
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq <= 0) return 'malformed';
    const key = part.slice(0, eq);
    if (pairs.has(key)) return 'duplicate_key';
    let value: string;
    try {
      value = decodeURIComponent(part.slice(eq + 1));
    } catch {
      return 'malformed';
    }
    pairs.set(key, value);
  }
  return pairs;
}

export function signInitData(pairs: ReadonlyMap<string, string>, botToken: string): string {
  const launchParams = [...pairs.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  return createHmac('sha256', secretKey).update(launchParams).digest('hex');
}

function parseJson(value: string | undefined): Record<string, unknown> | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function verifyInitData(
  raw: string,
  botToken: string,
  now: Date,
  options: { maxAgeSec: number; clockSkewSec: number },
): { ok: true; data: VerifiedInitData } | { ok: false; error: InitDataError } {
  const pairs = parsePairs(raw.trim());
  if (typeof pairs === 'string') return { ok: false, error: pairs };
  const hash = pairs.get('hash');
  if (hash === undefined || !HEX_HASH.test(hash)) return { ok: false, error: 'no_hash' };

  const expected = Buffer.from(signInitData(pairs, botToken), 'hex');
  const actual = Buffer.from(hash, 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { ok: false, error: 'bad_signature' };

  const authSec = Number(pairs.get('auth_date'));
  if (!Number.isInteger(authSec) || authSec <= 0) return { ok: false, error: 'malformed' };
  const ageSec = (now.getTime() - authSec * MS_PER_SECOND) / MS_PER_SECOND;
  if (ageSec > options.maxAgeSec + options.clockSkewSec || ageSec < -options.clockSkewSec) return { ok: false, error: 'expired' };

  const user = parseJson(pairs.get('user'));
  const userId = user?.id;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0) return { ok: false, error: 'no_user' };
  const chat = parseJson(pairs.get('chat'));
  const startParam = pairs.get('start_param') ?? null;
  return {
    ok: true,
    data: {
      user: { id: userId, languageCode: typeof user?.language_code === 'string' ? user.language_code : null },
      chat: chat && typeof chat.id === 'number' && typeof chat.type === 'string' ? { id: chat.id, type: chat.type } : null,
      startParam: startParam !== null && START_PARAM.test(startParam) ? startParam : null,
      authDate: new Date(authSec * MS_PER_SECOND),
    },
  };
}
