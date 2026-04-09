import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock Next.js router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  redirect: jest.fn(),
}));

// Mock cookies for server components
jest.mock('next/headers', () => ({
  cookies: () => ({
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    getAll: jest.fn(() => []),
    has: jest.fn(),
  }),
  headers: () => ({
    get: jest.fn(),
    has: jest.fn(),
    entries: jest.fn(() => []),
    keys: jest.fn(() => []),
    values: jest.fn(() => []),
  }),
}));

// Mock environment variables
process.env.DB_BACKEND = 'sqlite';
process.env.SECRET_SALT = 'test-salt';
// Enable auth mode in tests by default so API routes exercise the auth branches.
process.env.AGX_BOARD_ENABLE_AUTH = process.env.AGX_BOARD_ENABLE_AUTH || '1';
process.env.NEXT_PUBLIC_AGX_BOARD_ENABLE_AUTH = process.env.NEXT_PUBLIC_AGX_BOARD_ENABLE_AUTH || '1';
process.env.AGX_BOARD_DISABLE_AUTH = '0';
process.env.NEXT_PUBLIC_AGX_BOARD_DISABLE_AUTH = '0';

// Suppress console warnings during tests
const originalWarn = console.warn;
console.warn = (...args) => {
  if (args[0]?.includes?.('ReactDOMTestUtils.act')) return;
  originalWarn(...args);
};
