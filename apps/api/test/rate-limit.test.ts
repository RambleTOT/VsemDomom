import { describe, expect, it } from 'vitest';
import { authRateLimit, codeRateLimit, DEFAULT_RATE_LIMITS } from '../src/http/rate-limit.ts';

describe('лимиты входа и ввода кода', () => {
  it('вход с одного IP — 60 в минуту, ввод демо-кода — 10 в минуту на пользователя', () => {
    expect(authRateLimit(DEFAULT_RATE_LIMITS).max).toBe(60);
    expect(codeRateLimit(DEFAULT_RATE_LIMITS).max).toBe(10);
    // Лимит кода не задан — как вход (тестовые лимиты).
    expect(codeRateLimit({ userPerMinute: 3, authPerMinute: 2 }).max).toBe(2);
  });
});
