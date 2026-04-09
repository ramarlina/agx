const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@assistant-ui/react$': '<rootDir>/__tests__/mocks/assistant-ui-react.tsx',
    '^@assistant-ui/react-ai-sdk$': '<rootDir>/__tests__/mocks/assistant-ui-react-ai-sdk.ts',
    '^cel-js$': '<rootDir>/__tests__/helpers/cel-js-shim.cjs',
  },
  transformIgnorePatterns: ['/node_modules/(?!(cel-js|uuid)/)'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/.worktrees/',
    '<rootDir>/e2e/',
    '<rootDir>/__tests__/mocks/',
    '<rootDir>/__tests__/helpers/',
  ],
  modulePathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.worktrees/'],
  watchPathIgnorePatterns: ['<rootDir>/.next/', '<rootDir>/.worktrees/'],
  coveragePathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/.next/',
    '<rootDir>/app/api/auth/\\[...nextauth\\]/', // NextAuth passthrough
    '<rootDir>/lib/auth-client.ts', // Client-side auth - requires browser
    '<rootDir>/lib/auth-server.ts', // Server-side auth - requires DB
    '<rootDir>/lib/auth.ts', // Auth wrapper
    '<rootDir>/lib/orchestrator.ts', // Complex state machine
  ],
  collectCoverageFrom: [
    'lib/**/*.{js,ts}',
    'components/**/*.{js,ts,tsx}',
    'app/api/**/*.{js,ts}',
    'hooks/**/*.{js,ts}',
    '!**/*.d.ts',
    '!**/node_modules/**',
    '!lib/auth*.ts',
    '!lib/orchestrator.ts',
  ],
  coverageThreshold: {
    // Core security module must maintain high coverage
    './lib/security.ts': {
      branches: 70,
      functions: 90,
      lines: 85,
      statements: 85,
    },
    // API routes that handle auth/security (exclude nextauth passthrough)
    './app/api/auth/daemon-secret/route.ts': {
      branches: 60,
      functions: 60,
      lines: 70,
      statements: 70,
    },
    './app/api/auth/status/route.ts': {
      branches: 90,
      functions: 90,
      lines: 90,
      statements: 90,
    },
    // Global threshold - tracks lib, API routes, and hooks
    // Components have lower coverage due to complex UI mocking
    global: {
      branches: 30,
      functions: 30,
      lines: 40,
      statements: 40,
    },
  },
};

// next/jest overrides transformIgnorePatterns, so we need to force ours after
const baseConfig = createJestConfig(customJestConfig);
module.exports = async () => {
  const config = await baseConfig();
  config.transformIgnorePatterns = ['/node_modules/(?!(cel-js|uuid)/)'];
  return config;
};
