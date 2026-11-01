import { defineConfig } from 'vitest/config';

// Local days and morning starts are local time, so every test runs in UTC,
// however it is started; the workers inherit this zone.
process.env.TZ = 'UTC';

export default defineConfig({
	test: {
		setupFiles: ['test/setup.js']
	}
});
