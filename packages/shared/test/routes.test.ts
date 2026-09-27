import { describe, expect, it } from 'vitest';
import { apiRoutes } from '../src/index.ts';

describe('таблица маршрутов API', () => {
  it('operationId уникальны', () => {
    const ids = apiRoutes.map((r) => r.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('пара метод + путь уникальна', () => {
    const keys = apiRoutes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('у каждого маршрута есть успешный ответ', () => {
    for (const r of apiRoutes) {
      expect(Object.keys(r.responses).some((code) => Number(code) < 300), r.operationId).toBe(true);
    }
  });
});
