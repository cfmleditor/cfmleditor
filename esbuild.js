const esbuild = require('esbuild');
const path = require('node:path');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const polyfill = require('@esbuild-plugins/node-globals-polyfill');
// Use the HTML service's ESM entry so esbuild can resolve its internal imports.
const aliases = {
  'vscode-html-languageservice': require.resolve('vscode-html-languageservice/lib/esm/htmlLanguageService.js'),
};
// const esbuildPluginTsc = require('esbuild-plugin-tsc');

async function main() {
  const desktop = await esbuild.context({
    entryPoints: ['src/cfmlMain.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/desktop/extension.js',
    external: ['vscode'],
    alias: aliases,
    logLevel: 'warning',
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
	  // esbuildPluginTsc(),
    ]
  });
  if (watch) {
    await desktop.watch();
  } else {
    await desktop.rebuild();
    await desktop.dispose();
  }

  const web = await esbuild.context({
    entryPoints: ['src/cfmlMain.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'dist/web/extension.js',
    external: ['vscode', 'fs', 'path', 'os', 'https', 'zlib', 'stream', 'stream/promises', 'child_process', 'net', 'tls', 'crypto', 'vscode-languageclient/node', 'tar-stream'],
    alias: aliases,
    define: {
      global: 'globalThis'
    },
    logLevel: 'warning',
    plugins: [
		polyfill.NodeGlobalsPolyfillPlugin({
			process: true,
			buffer: true
		}),
		replacePath(),
		esbuildProblemMatcherPlugin,
		// esbuildPluginTsc(),
    ]
  });
  if (watch) {
    await web.watch();
  } else {
    await web.rebuild();
    await web.dispose();
  }
}

const replacePath = () => {
    const replace = {
        'path': require.resolve('path-browserify'),
        'buffer': require.resolve('buffer/'),
        'util': require.resolve('util/')
    }
    const filter = RegExp(`^(${Object.keys(replace).join("|")})$`);
    return {
        name: "replacePath",
        setup(build) {
            build.onResolve({ filter: /\/cfmlLspClient$/ }, () => ({
                path: path.join(__dirname, 'src/lsp/cfmlLspClient.web.ts'),
            }));
            build.onResolve({ filter }, arg => ({
                path: replace[arg.path],
            }));
        },
    };
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd(result => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  }
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
