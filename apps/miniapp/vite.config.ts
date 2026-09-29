import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

// Пакеты рабочего пространства берутся из исходников (условие "source"); API локально — прокси на api.
export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  // Один файл без догружаемых частей: открытое до выкладки приложение не ищет удалённые файлы (≈175 КБ в gzip).
  build: { outDir: 'dist', target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 800 },
});
