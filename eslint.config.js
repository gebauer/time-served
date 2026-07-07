// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // server/ is PocketBase JS (its own runtime globals; J7 owns its checks)
    ignores: ['dist/*', 'android/*', 'ios/*', 'server/**', '.expo/*'],
  },
  {
    // CLAUDE.md §6/§10: domain and ui never import native APIs. Enforced
    // mechanically — platform adapters, data/ and modules/ are the only places
    // allowed to touch react-native / expo-* / native libs.
    files: ['src/domain/**', 'src/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react-native',
                'react-native-*',
                'expo',
                'expo-*',
                '@nozbe/*',
                '*/platform/android/*',
                '*/platform/ios/*',
              ],
              message:
                'Native imports are forbidden here (CLAUDE.md §6): domain/ui talk to platform interfaces and repository contracts only.',
            },
          ],
        },
      ],
    },
  },
  {
    // ui/ may use react-native components (it renders), but not the rest.
    files: ['src/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react-native-*',
                'expo-*',
                '@nozbe/*',
                '*/platform/android/*',
                '*/platform/ios/*',
              ],
              message:
                'ui/ renders with react-native but must not touch native modules or adapters (CLAUDE.md §6/§7) — go through hooks that wrap the domain layer.',
            },
          ],
        },
      ],
    },
  },
]);
