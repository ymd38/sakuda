// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({ ignores: ['.output/**', 'data/**', 'server/db/migrations/**'] })
