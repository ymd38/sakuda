import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

const root = fileURLToPath(new URL('./', import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { '#shared': `${root}shared` } },
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/**/__tests__/**/*.spec.ts'],
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          environment: 'nuxt',
          include: ['tests/nuxt/**/*.spec.ts'],
          environmentOptions: { nuxt: { domEnvironment: 'happy-dom' } },
        },
      }),
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['tests/e2e/**/*.spec.ts'],
          testTimeout: 180_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
})
