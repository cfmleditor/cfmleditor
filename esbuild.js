const esbuild = require('esbuild');
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const polyfill = require('@esbuild-plugins/node-globals-polyfill');
const esbuildPluginTsc = require('esbuild-plugin-tsc');
const glob = require('glob');
const path = require('path');

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
    logLevel: 'warning',
    plugins: [
      /* add to the end of plugins array */
      esbuildProblemMatcherPlugin,
	  esbuildPluginTsc(),
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
    external: ['vscode'],
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
		esbuildPluginTsc(),
    ]
  });
  if (watch) {
    await web.watch();
  } else {
    await web.rebuild();
    await web.dispose();
  }

  const webTests = await esbuild.context({
    entryPoints: ['src/test/web/extension.test.ts'],
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'browser',
    outdir: 'dist/web',
    external: ['vscode'],
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
		testBundlePlugin,
		esbuildProblemMatcherPlugin,
		esbuildPluginTsc(),
    ]
  });
  if (watch) {
    await webTests.watch();
  } else {
    await webTests.rebuild();
    await webTests.dispose();
  }
}

const replacePath = () => {
    const replace = {
        'path': require.resolve('path-browserify'),
        'buffer': require.resolve('buffer/')
    }
    const filter = RegExp(`^(${Object.keys(replace).join("|")})$`);
    return {
        name: "replacePath",
        setup(build) {
            build.onResolve({ filter }, arg => ({
                path: replace[arg.path],
            }));
        },
    };
}


/**
 * Web Test Bundler Plugin (Only needed for web test build)
 * @type {import('esbuild').Plugin}
 */
const testBundlePlugin = {
	name: 'testBundlePlugin',
	setup(build) {
		build.onResolve({ filter: /[\/\\]extension.test\.ts$/ }, args => {
			if (args.kind === 'entry-point') {
				return { path: path.resolve(args.path) };
			}
		});
		build.onLoad({ filter: /[\/\\]extension.test\.ts$/ }, async args => {
			// Ensure the path construction is robust
			const testsRoot = path.resolve(__dirname, 'src/test/web');
			const pattern = '*.test.{ts,tsx}';
			// Use path.posix.join for consistent glob patterns, especially on Windows
			const globPattern = path.posix.join(testsRoot.replace(/\\/g, '/'), pattern);

			// Use glob.glob with absolute paths for clarity
			const files = await glob.glob(globPattern, { absolute: true });

			// Generate relative import paths from the perspective of extensionTests.ts location
			const importerDir = path.dirname(args.path); // Directory of the virtual extensionTests.ts
			const relativeImports = files.map(f => {
				const relativePath = path.relative(importerDir, f).replace(/\\/g, '/');
				// Ensure it starts with './' if in the same or subdirectory
				return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
			});

			const watchDirs = Array.from(new Set(files.map(f => path.dirname(f)))); // Unique directories

			console.log('[testBundlePlugin] Found test files:', files);
			console.log('[testBundlePlugin] Generated imports:', relativeImports);

			return {
				contents:
					`export { run } from './mochaTestRunner';\n` + // Assuming mochaTestRunner is relative
					relativeImports.map(f => `import('${f}');`).join('\n'),
				// Resolve relative to the importer's directory for watchDirs/Files
				resolveDir: importerDir,
				watchDirs: watchDirs,
				watchFiles: files
			};
		});
	}
};


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