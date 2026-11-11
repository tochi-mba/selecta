import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { setMutationRetryDelays } from '../api';
import { setFlags } from '../flags';

// Every test starts as the real app does once `/api/status` has answered with no flags turned
// off: every feature on, and known to be. Work gated on `useFlagHeard` waits until the server
// has said, so leaving flags unheard would quietly stop it asking the server anything. A test
// about the moment before the server answers calls `setFlags(null)` itself.
beforeEach(() => {
  setFlags({});
  // T0094: a change that got no answer is not resent in tests unless a test asks for it, so
  // tests that simulate a stopped server see its failure at once (api.ts, mutationRetryDelays)
  setMutationRetryDelays([]);
});

afterEach(() => {
  cleanup();
  setFlags({});
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});
