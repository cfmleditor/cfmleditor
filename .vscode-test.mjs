import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	files: 'out/test/**/*.test.js',
	workspaceFolder: "src/test/workspace",
	mocha: {
		ui: "bdd",
		preload: ['source-map-support/register'],
	}
});
