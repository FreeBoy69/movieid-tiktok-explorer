import '@testing-library/jest-dom';
import { expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.history for tests
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'history', {
    writable: true,
    value: {
      pushState: () => {},
      replaceState: () => {},
      back: () => {},
      forward: () => {},
      go: () => {},
      length: 0,
      state: null,
      scrollRestoration: 'auto' as ScrollRestoration,
    },
  });
}
