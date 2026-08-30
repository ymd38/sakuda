// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  { ignores: ['.output/**', 'data/**', 'server/db/migrations/**'] },
  {
    // Match Prettier's own Vue formatting, which always self-closes void
    // elements (<input />) — without this, eslint --fix and prettier
    // --write fight over the same tags.
    rules: {
      'vue/html-self-closing': [
        'error',
        {
          html: { void: 'always', normal: 'always', component: 'always' },
          svg: 'always',
          math: 'always',
        },
      ],
    },
  },
)
