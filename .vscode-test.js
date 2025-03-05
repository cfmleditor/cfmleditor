// .vscode-test.js
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([
  {
    label: 'unitTests',
    files: 'out/test/**/*.test.js',
	extensionDevelopmentPath: __dirname,
	extensionTestsPath: './out/test',
    version: 'insiders',
    workspaceFolder: `${__dirname}/test-workspace`,
    mocha: {
	  ui: 'bdd',
      timeout: 20000
    }
  }
  // you can specify additional test configurations, too
]);