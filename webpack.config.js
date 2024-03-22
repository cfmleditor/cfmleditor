const path = require('path');
const webpack = require('webpack');

/** @typedef {import('webpack').Configuration} WebpackConfig **/
/** @type WebpackConfig */
const webExtensionConfig = {
  mode: 'production', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')
  target: 'webworker', // extensions run in a webworker context
  entry: {
    extension: './src/cfmlMain.ts' // source of the web extension test runner
  },
  output: {
    filename: 'cfmlMain.js',
    path: path.join(__dirname, 'dist/web'),
    libraryTarget: 'commonjs'
  },
  resolve: {
    mainFields: ['browser', 'module', 'main'], // look for `browser` entry point in imported node modules
    extensions: ['.ts', '.js'], // support ts-files and js-files
    alias: {
    },
    fallback: {
        path: require.resolve('path-browserify'),
        "buffer": false,
        "async_hooks": false,
    },
  },

  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader'
          }
        ]
      }
    ]
  },
  plugins: [
    new webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
        process: 'process/browser'
    })
  ],
  externals: {
    vscode: 'commonjs vscode' // ignored because it doesn't exist
  },
  performance: {
    hints: false
  },
  devtool: 'nosources-source-map' // create a source map that points to the original source file
};
module.exports = [webExtensionConfig];