import { defineProject } from 'vitest/config';

export default defineProject({
  // Пакеты рабочего пространства в тестах берутся из исходников (условие экспорта "source").
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    name: 'api',
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Интеграционные тесты пересоздают схему общей тестовой базы — файлы идут по очереди.
    fileParallelism: false,
    // Подготовка стенда (схема, миграции, сиды, вход жителей) на медленной машине дольше 10 секунд.
    hookTimeout: 30_000,
  },
});
