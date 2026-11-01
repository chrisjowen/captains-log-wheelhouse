import { afterEach, beforeEach, vi } from 'vitest';
import { NOW } from './now.js';

// It is NOW in every test, whatever today is. Only Date is faked: timers and
// I/O run for real.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => vi.useRealTimers());
