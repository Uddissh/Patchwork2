// Minimal lint config — identifiers only (no-undef). Host globals declared
// because the app touches browser APIs directly.
const reactHooksStub = {
  rules: {
    // The source carries eslint-disable directives for this rule from a full
    // react-hooks setup; stub it so those directives resolve and the
    // no-undef pass stays clean.
    'exhaustive-deps': { create: () => ({}) },
  },
}

export default [
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooksStub },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        sessionStorage: 'readonly',
        localStorage: 'readonly',
        location: 'readonly',
        history: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        requestIdleCallback: 'readonly',
        performance: 'readonly',
        console: 'readonly',
        URLSearchParams: 'readonly',
        URL: 'readonly',
        CSS: 'readonly',
        fetch: 'readonly',
        getComputedStyle: 'readonly',
        HTMLElement: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        FormData: 'readonly',
        WebSocket: 'readonly',
      },
    },
    rules: {
      'no-undef': 'error',
      // Core ESLint doesn't count JSX tag usage without the react plugin, so
      // component imports (capitalized) are exempt; hooks/helpers stay strict.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]', argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-dupe-keys': 'error',
      'no-const-assign': 'error',
      'no-unreachable': 'error',
      'no-duplicate-case': 'error',
      'no-fallthrough': 'error',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
]
