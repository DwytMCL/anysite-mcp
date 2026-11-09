import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'shortcuts-library/dist/', '_site/'] },
  js.configs.recommended,
  { languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
    // Destructuring with ...rest is how keys are left out, e.g. { action, expect, ...raw }.
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] } },
  // Packs pass callbacks to page.evaluate, which run in the page.
  { files: ['sites/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  { files: ['shortcuts-library/app.js'], languageOptions: { globals: globals.browser } },
];
