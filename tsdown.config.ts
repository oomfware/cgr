import { cp } from 'node:fs/promises';

import { defineConfig } from 'tsdown';

export default defineConfig({
	entry: ['src/index.ts'],
	format: 'esm',
	dts: false,
	onSuccess: async () => {
		await cp('src/assets', 'dist/assets', { recursive: true });
	},
});
