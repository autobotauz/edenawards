import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// The web tests run the real API + SQLite in-process; under coverage instrumentation that
// can take longer than Testing Library's 1s default, so allow more time before failing.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// jsdom lacks these browser APIs.
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
}
window.scrollTo = () => {};
