module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
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
  // Force exit after tests to handle open handles
  forceExit: true,
};
