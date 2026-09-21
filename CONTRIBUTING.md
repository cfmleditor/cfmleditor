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

- `npm run bundle-server -- --target darwin-arm64` puts that platform's binary in
  `server/`. Targets are the [`vsce` ones](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#platformspecific-extensions):
  `win32-x64`, `win32-arm64`, `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`.
- `npx vsce package --target darwin-arm64` then builds that platform's package.
- The release workflow does both for every target, plus one universal package
  built from a clean checkout with no `server/` — that is what installs on
  platforms the server is not built for, and it downloads a binary on demand.
  Delete `server/` before building a universal package by hand, or it will ship
  one platform's binary to everyone.

`server/` is generated and git-ignored; nothing needs it to run the extension
from source, which downloads a server the first time one is enabled.

## Guidelines

- Code should pass **ESLint** and **markdownlint** with the included configuration.
- Please use descriptive variable names and only use well-known abbreviations.
