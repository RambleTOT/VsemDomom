import { defineProject } from 'vitest/config';

export default defineProject({
  // Пакеты рабочего пространства в тестах берутся из исходников (условие экспорта "source").
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'shared',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
