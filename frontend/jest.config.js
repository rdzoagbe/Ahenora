/**
 * Two suites, because they need different machines.
 *
 * Everything here used to run in a `node` environment under ts-jest, which
 * cannot render a React Native component at all. So the frontend tests read
 * source files as TEXT and asserted with regular expressions — 14 of them. That
 * is a real check on structure, and a useless one on behaviour: a component can
 * be asserted into existence by a passing test and still throw the moment it
 * renders.
 *
 * That is not a hypothetical either. A voice recorder shipped with a green
 * suite and stopped the app launching, because the guard protecting it was
 * proved against a mock rather than against a render.
 *
 * So: `unit` keeps the existing arrangement, unchanged, for source checks and
 * pure logic. `components` runs under jest-expo, where a component actually
 * mounts. New behaviour goes in the second one.
 */
const unit = {
  displayName: 'unit',
  preset: 'ts-jest/presets/js-with-babel',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)/|expo(nent)?/|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|lucide-react-native)',
  ],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
};

const components = {
  displayName: 'components',
  // The React Native preset, not jest-expo: jest-expo carries jest 29
  // internals and this repo runs jest 30, which fails inside the runtime
  // before a single test body executes. The RN preset is built for this
  // version, and the Expo mocks jest-expo would have supplied are the two
  // in jest.setup.tsx — written explicitly, where they can be read.
  preset: '@react-native/jest-preset',
  // .tsx only, so the two projects cannot both claim a file.
  testMatch: ['**/__tests__/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.tsx'],
  // The RN preset resolves .js first; without tsx here an import of a
  // TypeScript component reads as a missing module.
  moduleFileExtensions: ['tsx', 'ts', 'jsx', 'js', 'json'],
  moduleNameMapper: {
    // The RN preset follows the `react-native` field, which points at an ESM
    // bundle the preset then declines to transform. The CJS build is the same
    // icons and parses.
    '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)/|expo(nent)?/|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|lucide-react-native|react-native-safe-area-context|@testing-library/.*)',
  ],
};

module.exports = { projects: [unit, components] };
