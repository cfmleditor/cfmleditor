import { defineConfig } from '@vscode/test-cli';

const isCI = process.env.CI === 'true';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: "src/test/workspace",
	mocha: {
		ui: "bdd",
		preload: ['source-map-support/register'],
		...(isCI && {
			reporter: "json",
			reporterOptions: {
				output: "test-results.json",
			},
		}),
	}
});
