module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/__tests__/helpers/jest-global-shims.cjs'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testMatch: ['**/__tests__/**/*.test.@(ts|tsx|js)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testTimeout: 15000,
  collectCoverageFrom: [
    'lib/**/*.js',
    '!**/node_modules/**',
  ],
  coverageThreshold: {
    // Only check lib folder - index.js is CLI entry point, hard to unit test
    './lib/': {
      branches: 45,
      functions: 50,
      lines: 55,
      statements: 55,
    },
    './lib/security.js': {
      branches: 55,
      functions: 65,
      lines: 60,
      statements: 60,
    },
    './lib/executor.js': {
      branches: 70,
      functions: 75,
      lines: 80,
      statements: 80,
    },
    './lib/worker.js': {
      branches: 70,
      functions: 70,
      lines: 85,
      statements: 85,
    },
  },
  modulePathIgnorePatterns: ['<rootDir>/todo-api/'],
  transform: {
    '^.+\\.[tj]sx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  moduleNameMapper: {
    '^react$': '<rootDir>/node_modules/react',
    '^react/jsx-runtime$': '<rootDir>/node_modules/react/jsx-runtime.js',
    '^react/jsx-dev-runtime$': '<rootDir>/node_modules/react/jsx-dev-runtime.js',
    '^react-dom$': '<rootDir>/node_modules/react-dom',
    '^react-dom/client$': '<rootDir>/node_modules/react-dom/client.js',
    '^@/(.*)$': '<rootDir>/../agx-cloud/$1',
    '^yaml$': '<rootDir>/node_modules/yaml/dist/index.js',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  // Force exit after tests to handle open handles
  forceExit: true,
};
