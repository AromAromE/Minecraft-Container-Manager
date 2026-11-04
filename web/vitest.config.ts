import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  define: { __MCM_BUILD_COMMIT__: JSON.stringify('1234567890abcdef1234567890abcdef12345678') },
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    // Bound DOM-worker memory and CPU so interaction tests remain stable in CI.
    maxWorkers: 4,
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['tests/**/*.test.{ts,tsx}'],
  },
});
