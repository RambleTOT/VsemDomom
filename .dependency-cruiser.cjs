/**
 * Границы слоёв (проверяется в CI: pnpm depcruise).
 * core — чистая логика без ввода-вывода и без зависимостей внутри репозитория;
 * shared — контракт API, работает и в браузере; api зависит от core и shared;
 * miniapp — только от shared и сгенерированного клиента API.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-no-repo-deps',
      comment: 'packages/core ни от чего не зависит внутри репозитория',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: { path: '^(packages/(?!core/)[^/]+|apps)/' },
    },
    {
      name: 'core-no-io',
      comment: 'packages/core без ввода-вывода: ни модулей Node, ни драйверов, ни HTTP',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: {
        dependencyTypesNot: ['type-only'],
        path: '^node_modules/(pg|pg-boss|fastify|@fastify|pino|drizzle-orm|jose|undici)(/|$)',
      },
    },
    {
      name: 'core-no-node-builtins',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'shared-no-apps',
      severity: 'error',
      from: { path: '^packages/shared/src' },
      to: { path: '^apps/' },
    },
    {
      name: 'shared-no-node-builtins',
      comment: 'packages/shared используется мини-приложением в браузере',
      severity: 'error',
      from: { path: '^packages/shared/src' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'api-not-to-miniapp',
      severity: 'error',
      from: { path: '^apps/api' },
      to: { path: '^apps/miniapp' },
    },
    {
      name: 'miniapp-only-shared',
      comment: 'мини-приложение зависит только от shared и сгенерированного клиента API',
      severity: 'error',
      from: { path: '^apps/miniapp/src' },
      to: { path: '^(apps/api|packages/core)/' },
    },
    {
      name: 'no-src-to-tests',
      severity: 'error',
      from: { path: '/src/' },
      to: { path: '/test/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(dist|coverage)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['source', 'import', 'types', 'default'],
      extensions: ['.ts', '.js', '.json'],
    },
  },
};
