import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-08-30',
  modules: ['@nuxt/eslint', '@nuxt/test-utils/module'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  typescript: { strict: true },
  app: { head: { title: 'sakuda', htmlAttrs: { lang: 'ja' } } },
  nitro: { preset: 'node-server' },
})
