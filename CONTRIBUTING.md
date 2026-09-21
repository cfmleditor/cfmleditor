# Contributing

If you would like to contribute enhancements or fixes, please read this document first.

## Setup

- Fork [cfmleditor](https://github.com/cfmleditor/cfmleditor)
- Clone your forked repository
- Install [Node.js with npm](https://nodejs.org) if not already installed
- Open this project as the workspace in VS Code
- Install the recommended extensions in `.vscode/extensions.json`
- Run `npm install` at workspace root to install dependencies

## Working

- It is recommended to work on a separate feature branch created from the latest `master`.
- To debug, run the `Launch Extension` debug target in the [Debug View](https://code.visualstudio.com/docs/editor/debugging). This will:
  - Launch the `preLaunchTask` task to compile the extension
  - Launch a new VS Code instance with the `vscode-cfml` extension loaded
  - You will see a notification saying the development version of `vscode-cfml` overwrites the bundled version of `vscode-cfml` if you have an older version installed
- Make a pull request to the upstream `master`

## Packaging the language server

Released packages are platform-specific: each carries the `cfmleditor-lsp` binary for
its own platform in `server/`, so a first run needs no network and the download
path only ever fetches a *newer* server than the one that shipped. The version
that ships is `cfmlLspVersion` in `package.json`.

- **`npm run package-targets` builds the lot** into `packages/`: one VSIX per
  platform with that platform's server inside, then a universal one with no
  server. Takes about a minute and a half. `--targets linux-x64,darwin-arm64`
  narrows it, `--no-universal` skips the fallback package, `--out <dir>` moves
  the output. It prints the publish loop to run when you are ready.
- To do one target by hand: `npm run bundle-server -- --target darwin-arm64`
  puts that platform's binary in `server/`, then `npx vsce package --target
  darwin-arm64`. Targets are the [`vsce` ones](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions):
  `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`.
  Bundle before every package: `vsce package --target` does not check that
  `server/` holds that target's binary, and will happily ship whichever one was
  left there. Delete `server/` before building a universal package, or it goes
  to everyone. `package-targets` handles both, which is why it is the easier path.
- The release workflow does the same thing, one target per job, and publishes
  every package to the Marketplace, OpenVSX and the GitHub release under one
  version. The universal package is the fallback the Marketplace serves to
  platforms with no package of their own — armhf, alpine, web — and it
  downloads a server on demand.

`server/` and `packages/` are generated and git-ignored; nothing needs them to
run the extension from source, which downloads a server the first time one is
enabled.

## Guidelines

- Code should pass **ESLint** and **markdownlint** with the included configuration.
- Please use descriptive variable names and only use well-known abbreviations.
