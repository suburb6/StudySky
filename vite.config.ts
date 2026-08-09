import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      reporter: ['text', 'html']
    }
  }
});
