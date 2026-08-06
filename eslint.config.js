import tsParser from '@typescript-eslint/parser'

export default [
  { ignores: ['dist/**', 'node_modules/**', '**/*.d.ts'] },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
    rules: {
      'no-restricted-syntax': ['error',
        {
          selector: "MemberExpression[property.name='getBoundingClientRect']",
          message: 'Zoom layer: use ctx.ui.geometry.layoutElementRect(el) (R3.2).',
        },
        {
          selector: "MemberExpression[property.name=/^client[XY]$/]",
          message: 'Zoom layer: pointer coords are rendered px - use ctx.ui.geometry.toLayoutPx (R3.2).',
        },
        {
          selector: "MemberExpression[object.name='window'][property.name=/^inner(Width|Height)$/]",
          message: 'Zoom layer: use ctx.ui.geometry.layoutViewportSize() (R3.2).',
        },
        {
          selector: "MemberExpression[property.name=/^client(Width|Height)$/][object.property.name='documentElement']",
          message: 'Zoom layer: use ctx.ui.geometry.layoutViewportSize() (R3.2).',
        },
        {
          selector: 'TSAnyKeyword',
          message: 'Avoid explicit any; use unknown or a concrete type.',
        },
      ],
    },
  },
]
