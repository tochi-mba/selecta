import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { setFlags } from '../flags';

afterEach(() => {
  cleanup();
  setFlags(null);  // every test starts with every feature on, as a build with no flags set has
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
