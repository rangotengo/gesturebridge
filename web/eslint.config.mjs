import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

// eslint-plugin-react 7 does not yet support ESLint 10's rule context API.
// Keep Next, hooks, accessibility, import, and TypeScript rules active while
// disabling only the incompatible React rule family.
const incompatibleReactRules = Object.fromEntries(
  nextVitals
    .flatMap((config) => Object.keys(config.rules ?? {}))
    .filter((ruleName) => ruleName.startsWith('react/'))
    .map((ruleName) => [ruleName, 'off'])
);

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  { rules: incompatibleReactRules },
  globalIgnores([
    '.next/**',
    'dist-server/**',
    'coverage/**',
    'public/vendor/**',
    'next-env.d.ts',
  ]),
]);
