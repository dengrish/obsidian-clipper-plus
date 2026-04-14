import { defineConfig } from 'vitest/config';

// Pin timezone to UTC so date-related fixtures are deterministic across machines.
// Without this, tests like src/utils/template-integration.test.ts produce
// different {{date}} output depending on the host's local timezone.
process.env.TZ = 'UTC';

export default defineConfig({
	define: {
		DEBUG_MODE: false,
	},
	test: {
		include: ['src/**/*.test.ts'],
		globals: true,
		alias: {
			'webextension-polyfill': new URL('./src/utils/__mocks__/webextension-polyfill.ts', import.meta.url).pathname,
		},
	},
});
