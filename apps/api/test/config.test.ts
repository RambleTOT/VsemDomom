import { describe, expect, it } from 'vitest';
import { ConfigError, LOCAL_CHECKER_TOKENS, LOCAL_SESSION_SECRET, loadConfig } from '../src/config/env.ts';

const base = { DATABASE_URL: 'postgres://localhost/test', SESSION_SECRET: LOCAL_SESSION_SECRET };

function problems(env: Record<string, string>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (err) {
    if (err instanceof ConfigError) return err.problems;
    throw err;
  }
}

describe('loadConfig', () => {
  it('по умолчанию — симулятор, демо-режим, флаги волн 2–3 по таблице', () => {
    const c = loadConfig(base);
    expect(c.max.mode).toBe('simulator');
    expect(c.max.apiBase).toBe('https://platform-api2.max.ru');
    expect(c.demo.enabled).toBe(true);
    expect(c.devAuth).toBe(false);
    expect(c.checkWindowMin).toBe(360);
    expect(c.demo.checkWindowMin).toBe(5);
    expect(c.discrepancyMaxHours).toBe(72);
    expect(c.quietHours).toEqual({ from: '22:00', to: '08:00' });
    expect(c.features).toEqual({
      keywordReply: false,
      brigadeConfirm: true,
      trustLevels: true,
      joinChat: true,
      polls: true,
      monthlySummary: true,
      actTemplate: true,
    });
  });

  it('пустые строки из .env считаются незаданными', () => {
    const c = loadConfig({ ...base, MAX_BOT_TOKEN: '', ALERT_USER_ID: '', FEATURE_POLLS: '', SEED_UK_STAFF_MAX_IDS: '' });
    expect(c.max.botToken).toBeUndefined();
    expect(c.alertUserId).toBeUndefined();
    expect(c.features.polls).toBe(true);
    expect(c.seedStaffMaxIds).toEqual([]);
  });

  it('разбирает список MAX ID сотрудников', () => {
    expect(loadConfig({ ...base, SEED_UK_STAFF_MAX_IDS: '123, 456' }).seedStaffMaxIds).toEqual([123, 456]);
    expect(problems({ ...base, SEED_UK_STAFF_MAX_IDS: '12a' })).toHaveLength(1);
  });

  it('webhook требует токен, имя бота, секрет и https', () => {
    const p = problems({ ...base, MAX_MODE: 'webhook' });
    expect(p.join('\n')).toMatch(/MAX_BOT_TOKEN/);
    expect(p.join('\n')).toMatch(/MAX_BOT_USERNAME/);
    expect(p.join('\n')).toMatch(/MAX_WEBHOOK_SECRET/);
    expect(p.join('\n')).toMatch(/https/);
  });

  it('проверяет формат секрета webhook', () => {
    expect(problems({ ...base, MAX_WEBHOOK_SECRET: 'abc' })).toHaveLength(1);
    expect(problems({ ...base, MAX_WEBHOOK_SECRET: 'bad secret!' })).toHaveLength(1);
    expect(problems({ ...base, MAX_WEBHOOK_SECRET: 'good_secret-123' })).toEqual([]);
  });

  it('DEV_AUTH запрещён в webhook и в production', () => {
    const webhook = {
      ...base,
      MAX_MODE: 'webhook',
      MAX_BOT_TOKEN: 'x',
      MAX_BOT_USERNAME: 'bot',
      MAX_WEBHOOK_SECRET: 'secret_12345',
      PUBLIC_BASE_URL: 'https://app.example.ru',
      DEV_AUTH: 'true',
    };
    expect(problems(webhook).join('\n')).toMatch(/DEV_AUTH/);
    expect(problems({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), DEV_AUTH: 'true' }).join('\n')).toMatch(
      /DEV_AUTH/,
    );
  });

  it('в production не принимает тестовые секреты из .env.example', () => {
    expect(problems({ ...base, NODE_ENV: 'production' }).join('\n')).toMatch(/SESSION_SECRET/);
    expect(
      problems({ ...base, NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(40), CHECKER_TOKEN_UK: LOCAL_CHECKER_TOKENS[2]! }).join('\n'),
    ).toMatch(/CHECKER_TOKEN/);
  });

  it('checker-токены не короче 24 символов', () => {
    expect(problems({ ...base, CHECKER_TOKEN_RESIDENT: 'short' }).join('\n')).toMatch(/24/);
  });

  it('SESSION_SECRET обязателен и не короче 32 символов', () => {
    expect(problems({ DATABASE_URL: 'postgres://x' }).join('\n')).toMatch(/SESSION_SECRET/);
    expect(problems({ ...base, SESSION_SECRET: 'short' }).join('\n')).toMatch(/32/);
  });

  it('тихие часы — формат HH:MM-HH:MM', () => {
    expect(loadConfig({ ...base, QUIET_HOURS: '23:30-07:00' }).quietHours).toEqual({ from: '23:30', to: '07:00' });
    expect(problems({ ...base, QUIET_HOURS: '25:00-07:00' })).toHaveLength(1);
  });

  it('версию сборки берёт из окружения', () => {
    const c = loadConfig({ ...base, GIT_COMMIT: 'abc1234', BUILT_AT: '2026-09-27T12:00:00Z' });
    expect(c.build).toEqual({ commit: 'abc1234', builtAt: '2026-09-27T12:00:00Z' });
  });
});
