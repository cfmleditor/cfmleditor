# Change Log

All notable changes to the CFML extension will be documented in this file.

## [Unreleased]

- **The language server now ships with the extension.** Platform-specific packages carry the `cfmleditor-lsp` binary for their own platform, so enabling `cfml.lsp.enabled` needs no network at all on a first run. The download path stays, but only ever fetches a *newer* server than the one that shipped — a GitHub nobody at your site can reach now costs an upgrade rather than every language feature. Platforms without a published server still install the universal package and download as before.
- **Fixed the server never installing on Windows.** Extracting the release zip shelled out to `unzip`, which stock Windows does not have — so the only platform that was handed a zip was the only one that could not open it. All platforms now take the `.tar.gz`, which extracts in-process; the zip stays as a fallback for pinned versions older than v0.2.6, and is unpacked in-process too.
- **Fixed Windows on ARM asking for a binary that does not exist.** It requested `windows-arm64`, which has not been published since v0.1.12, and got an HTTP 404 that read like a broken release. It now runs the amd64 build, as Windows does for any other x64 program.
- **Downloads time out, and go through your proxy even when VS Code is not doing it for you.** Nothing set a timeout, so a network that black-holes packets rather than refusing them hung activation indefinitely — and because the extension's own providers stand down for a server that was never going to arrive, that left the editor with no CFML features at all and nothing on screen to say why. Every request now gives up after 30 seconds of silence. Proxies were only ever handled by VS Code's own `http.proxySupport`, so turning that off meant no proxy support at all; `http.proxy`, `https_proxy`/`http_proxy` and `no_proxy` are read directly now, with the tunnel VS Code substitutes its own for at the default `override` setting.
- **A server that fails to start now says so.** The error was swallowed by a catch meant for the web build, where the module does not load at all, so a binary that would not execute produced no message anywhere. `CFML: Restart Language Server` also works after a failed start, rather than reporting that the previous start failed for as long as the window stayed open.
- The newest downloaded server is picked by version rather than by sorting directory names, which would have preferred v0.9.0 over v0.10.0.
- **What the extension stands down for is now `cfml.lsp.enabled`, not whether a server is currently answering.** The language moved back and forth underneath the editor while a server was starting, restarting for a changed setting, or coming back from a crash — ten providers re-registered and the whole workspace re-scanned each time, with both resolvers answering in between. It follows the setting now, so it is decided by what you asked for and stays decided. A server that is enabled but cannot run therefore leaves the language unanswered, and says so.
- **CFLint ships with the extension too.** The language server runs CFLint for diagnostics and fetched a ~90 MB native binary the first time it linted anything. Platform-specific packages now carry it beside the server, so that download happens only on platforms CFLint publishes no build for — and a `cflint` you installed yourself is still the one that runs.

## [0.7.4] - 2026-09-19

- **The extension stands down while the language server is running.** With `cfml.lsp.enabled` on, both sides answered the same requests: VS Code merges every registered provider's results, so completion came back doubled and go-to-definition offered two entries for one symbol — and the two disagreed, because the extension resolves from `cfml.mappings` while the server resolves from `.cfmleditor.json`. All ten of the extension's own providers now unregister when the server starts and come back if it stops, so a server that dies mid-session does not leave the window with no language features.
- **The extension no longer keeps its own copy of the component cache while the server is running.** The bulk scan of every `.cfc` at startup, and the two file-system watchers that kept it current, duplicated the index the server maintains through `didOpen`/`didChange`/`didSave` and `workspace/didChangeWatchedFiles` — on a large workspace, thousands of files parsed to answer nothing, since every provider that reads the cache has already stood down. Documents you have open are still cached, because the comment-toggle commands ask the cache whether a `.cfc` is script-syntax and those commands stay registered.
- The register/stand-down logic for both groups is one tested `GatedRegistration` rather than two near-identical sets of module functions. Its rules are easy to get subtly wrong and each now has a test: registering a second set while already up doubles every provider's answer, disposing twice is not harmless for a `FileSystemWatcher`, and the group must end up matching the server even when the server stops while the workspace scan it triggered is still running.
- **Added `CFML: Restart Language Server`.** A client that has given up on a repeatedly-failing server previously needed a window reload to recover, which was hard to guess at given the extension's own providers were standing down for it.
- Fixed `HTTP 403` when downloading the server binary. The release lookup used the GitHub API unauthenticated, which is rate-limited to 60 requests per hour per IP address and is routinely exhausted on shared or corporate addresses; it now reads the redirect from the `releases/latest` URL, which is not rate-limited.
- Server messages are no longer all logged as errors. `vscode-languageclient` reports everything a server writes to stderr at error level, so an ordinary startup line appeared in the log as `[error] cfmleditor-lsp dev`.

## [0.7.3] - 2026-09-19

- Expose the language server's formatter settings as `cfml.format.*`, and send them to the server as `initializationOptions`. The extension previously sent none, so every formatter setting — including `braceStyle`, `parenSpacing`, `paramBreakThreshold`, `blankLinesInBlocks` and `switchCaseIndent` — could only be reached by hand-editing a `.cfmleditor.json` in the project. Only settings you have actually set are sent, so an untouched install behaves exactly as before and a project's own `.cfmleditor.json` still wins key by key. Changing one restarts the server, since it reads these once at startup.

## [0.7.2] - 2026-07-02

- Added experimental CFML Language Server (LSP) client support (`cfml.lsp.enabled`, `cfml.lsp.path`, `cfml.lsp.version`) -- auto-downloads the `cfmleditor-lsp` binary from GitHub releases when enabled
- **Routes now resolve through the language server.** `Go to Route View` and `Go to Route Controller` are removed. The extension resolved routes itself, from `cfml.mappings` in VS Code settings, with the controller-naming convention hardcoded — while the server resolved them from the `routes` block in `.cfmleditor.json`. Two resolvers reading two config sources cannot agree, and the one that is wrong still opens a file, just not the right one. Ctrl-click a route in source instead: go-to-definition and document links both go through the server, which reads routes written as HTML attributes, `?do=` query parameters, JavaScript object keys and function arguments — none of which the removed commands understood.
- **Added `Generate Code Map` and `Show Code Map Statistics`.** The first writes a self-contained interactive report of every function and file in the workspace and the calls, routes, instantiations and includes between them; the second reports how much of the workspace resolves, without writing anything. Both need `cfml.lsp.enabled`, and say so rather than failing when the server is not running.
- Fixed web extension build failing to resolve `vscode-languageclient/node` and `tar-stream`
- Update dependencies

## [0.7.1] - 2026-04-01

- Update Minimum version of VSCode to `1.105.1`
- Update Typescript to v6

## [0.7.0] - 2026-01-27

- Update `cfmleditor` and `cfmleditor-lint` versions to `0.7.x` with the intention of keeping releases in sync
- Update dependencies
- Improve parsing performance

## [0.6.43] - 2025-10-28

- Update to typescript `5.9.3`
- Update dependencies

## [0.6.42] - 2025-07-31

- Update Minimum version of VSCode to `1.99.3`
- Fixes and Tests for CFScript comment line parsing ([\#109](https://github.com/cfmleditor/cfmleditor/issues/109)) ([\#105](https://github.com/cfmleditor/cfmleditor/issues/105))
- Improve component references and enable further tests ([\#38](https://github.com/cfmleditor/cfmleditor/issues/38))
- Reduce duplication of code for Application.cfm and Application.cfc application variable caching ([\#106](https://github.com/cfmleditor/cfmleditor/issues/106))
- Improve cfscript range calculations for better comment (Tag or Script) mode detection ([\#120](https://github.com/cfmleditor/cfmleditor/issues/120))
- Uncomment Anywhere feature / setting to allow for uncommenting of a comment block from anywhere within the comment block ([\#118](https://github.com/cfmleditor/cfmleditor/issues/118))
- CFDocs / Lucee docs, show minimum version on inline help ([\#72](https://github.com/cfmleditor/cfmleditor/issues/72))
- Fixes for Component and Function definitions not updating on save ([\#125](https://github.com/cfmleditor/cfmleditor/issues/125))

## [0.6.41] - 2025-07-05

- Remove support for `formulahendry.auto-close-tag` use in cfmleditor ([\#92](https://github.com/cfmleditor/cfmleditor/issues/92))
- Multi cursor auto tag close fixes / usability improvements ([\#88](https://github.com/cfmleditor/cfmleditor/pull/88))
- Added command and menu item "Copy CFC Package Path" to copy `component.dot.paths` ([\#80](https://github.com/cfmleditor/cfmleditor/issues/80))
- Added `cfml.webroot` setting to simplify mappings when a workspace subfolder is the server webroot. ([\#36](https://github.com/cfmleditor/cfmleditor/issues/36))

## [0.6.40] - 2025-04-09

- Added Lucee documentation as alternative to CFDocs -- `cfml.cfDocs.source`: `lucee` ([\#71](https://github.com/cfmleditor/cfmleditor/issues/71))
- Added support for using `.zip` files in `cfml.cfDocs.localPath`
- Added support for using URLs in `cfml.cfDocs.localPath`
- Fixed docblocks ([\#77](https://github.com/cfmleditor/cfmleditor/pull/77))

## [0.6.39] - 2025-04-06

- Lower VSCode minimum version to `1.96.0` to support Cursor

## [0.6.38] - 2025-03-31

- Regression / infinite loop trying to resolve Application.cfc when one doesn't exist in a parent directory

## [0.6.37] - 2025-03-31

- Added experimental `lookbehind.maxLength` and `lookahead.maxLength` settings for performance tuning of various context resolutions based on cursor position
- Updated `fast` Comment Ranges function to support nested CFML comments
- New Tests for Definition provider
- Update Definition provider to reduce false positives

## [0.6.36] - 2025-03-23

- Always return additional definitions where they exist
- Update SearchMode.EqualTo to filter function names that don't match
- Update to Folding Region regExp to include CF tag comments
- Generate warning alert where conflicting extensions are installed

## [0.6.35] - 2025-03-11

- Performance / reliability improvements for tag Completion on `<`
- Remove OpenBD from inline help and engine selection
- Update packaged CFDocs
- Fix issue with `QueryNew("")` causing parsing of variables to fail
- Implement initial Unit tests
- Various lint rule / code base improvements
- Update packages / dependencies

## [0.6.34] - 2025-02-25

- Fix broken "Go to definition"

## [0.6.33] - 2025-02-18

- Replace trie-prefix-tree with trie-search and simplify search implementation for user defined functions #41 ( fixes issues with $ in function name )
- Fix Inefficient Regular Expression Complexity in koa - <https://github.com/advisories/GHSA-593f-38f6-jp5m>
- Add support for cfscript tag islands

## [0.6.32] - 2025-02-17

- Use fast textdocument for caching PR #40 @pixilation - improves the performance of the CFML: Refresh cache for workspace definitions command that runs on startup. This is the "Caching components" progress meter that appears.
- Bump packages (semver, vscode-uri, @vscode/vsce)

## [0.6.31] - 2025-01-22

- Bump dependencies

## [0.6.30] - 2024-09-18

- Fix for <https://github.com/cfmleditor/cfmleditor/issues/33>

## [0.6.28] - 2024-09-18

- Update path-to-regexp ( npm audit fix )

## [0.6.26] - 2024-09-02

- Update Dependencies

## [0.6.25] - 2024-08-07

- Fix regression with Tag / Script toggle comment logic

## [0.6.24] - 2024-08-05

- Performance Improvements
- Update packages / VSCode version to 1.92

## [0.6.23] - 2024-07-04

- Create "cfml.insertSnippet" command as a wrapper for editor.action.insertSnippet
- Update recommended extensions

## [0.6.22] - 2024-06-11

- Update cfml slack link
- Update dependencies

## [0.6.21] - 2024-04-23

- Fix include path resolution

## [0.6.20] - 2024-03-22

- Updates for cfmleditor-lint integration

## [0.6.19] - 2024-03-18

- Added .cfs file support

## [0.6.18] - 2024-03-15

- Multi line autoclose fixes

## [0.6.17] - 2024-03-14

- Fix relative path resolution

## [0.6.16] - 2024-03-10

- Test release

## [0.6.15] - 2024-03-10

- Upgraded TSLint to typescript-eslint plugin for ESLint
- Improvements for nested comments
- Various bug fixes

## [0.6.14] - 2024-02-02

- Pruned some packages
- Fixed some cfscript function parsing and highlighting

## [0.6.12] - 2024-01-12

- Further fixes to Auto Tag close
- Basic custom snippet path support

## [0.6.4]

- Improved Autoclose. Fixes issues with Undo/Redo ( behaviour options currently limited )
- Published as `cfmleditor` with new icon
- Support for `cfmleditor-lint` , recommend using this plugin for using CFLint with `cfmleditor`
- Update cfDocs service to use `fetch` APIs
- Update Extension to support vscode.dev web based install
- Setting for case / scope preference
- Fixes for crash when typing start of a line

## [0.5.4] - 2022-01-05

- Improved grammar
- Improved command registration and availability
- Now respects `files.exclude` for features
- Removed usage of CommandBox server schema. Please use [`ortus-solutions.vscode-commandbox`](https://github.com/Ortus-Solutions/vscode-commandbox) instead.
- Improved code documentation

## [0.5.3] - 2019-02-07

- Improved component parsing
- Added some more existence checks
- Fixed a hover error for expression tags
- Fixed a color provider error
- Fixed a couple issues with signature help detection
- Fixed a couple grammar scopes ([\#29](https://github.com/KamasamaK/vscode-cfml/issues/29))
- Fixed issue when reading compiled files
- Integrated `vscode-css-languageservice` and `vscode-html-languageservice` instead of using copied data

## [0.5.2] - 2019-01-18

- Added some existence checks
- Added some exception handling

## [0.5.1] - 2019-01-17

- Improved support and fixed bugs for interfaces and abstract functions ([\#27](https://github.com/KamasamaK/vscode-cfml/issues/27))
- Fixed a minor issue with signature help detection in a specific case

## [0.5.0] - 2019-01-13

- Update minimum version of VS Code to v1.30
- Update `target` and `lib` in tsconfig
- Added `DefinitionLink` support for providing definitions. This allows a full component path to be used for definition links.
- Added doc links for each engine on hover ([\#14](https://github.com/KamasamaK/vscode-cfml/issues/14))
- Added completions for `this`-scoped variables for external references of the component ([\#26](https://github.com/KamasamaK/vscode-cfml/pull/26))
- Added command `cfml.foldAllFunctions`
- Added setting for completing tag attributes with quotes -- `cfml.suggest.globalTags.attributes.quoteType` ([\#24](https://github.com/KamasamaK/vscode-cfml/issues/24))
- Added new `onEnterRules` rule for when the cursor is between an opening and closing tag ([\#23](https://github.com/KamasamaK/vscode-cfml/issues/23) and [\#24](https://github.com/KamasamaK/vscode-cfml/issues/24))
- Added setting for preferred case in global function suggestions -- `cfml.suggest.globalFunctions.firstLetterCase` ([\#25](https://github.com/KamasamaK/vscode-cfml/issues/25))
- Added folding region markers to language configuration
- Added hover and completion for HTML tags
- Added hover and completion for CSS properties
- Added color support for CSS property values
- Changed `ParameterInformation.label` to use new tuple type
- Removed Emmet setting and added instructions in `README`
- Fixed document symbols for implicit functions
- Fixed issue displaying multiple signatures
- Added CommandBox `server.json` schema
- Added progress notification when caching all components
- Improved parsing for signature help and added check for named parameters

## [0.4.1] - 2018-08-09

- Update minimum version of VS Code to v1.25
- Added commands `cfml.openCfDocs` and `cfml.openEngineDocs` ([\#14](https://github.com/KamasamaK/vscode-cfml/issues/14))
- Added notification for auto-close-tag extension when not installed and setting is enabled
- Added support for new ACF 2018 syntax
- Added a setting that will enable a definition search in a workspace if a reliable function definition cannot be found
- Improved support for functions defined in cfm files
- Improved suggestions for closures assigned to variables
- Fixed exception suggestions for type `any`
- Fixed syntax highlighting issue for variable properties with numeric keys
- Updated Tasks to 2.0.0
- Updated `DocumentSymbolProvider` to provide new `DocumentSymbol` type

## [0.4.0] - 2018-06-04

- Update minimum version of VS Code to v1.22
- Added support for custom mappings
- Added setting for whether to provide definitions
- Added more type definitions
- Added scopes to settings to indicate whether they are resource-based or window-based
- Added ability and configuration to have attributes populated for global tag completions
- Added command to open Application file for active document
- Added command to go to matching CFML tag
- Application and Server variables initialized in their respective components are now cached and properly considered for various features
- Improved catch information and suggestions
- Improved suggestions for queries initialized in the same file/block
- Improved docblock parsing
- Fixed detection of certain variable assignments within switch statements
- Fixed some syntax highlighting issues ([\#12](https://github.com/KamasamaK/vscode-cfml/issues/12)+)
- Limited suggestions for script tags to only be in script context
- Some refactoring

## [0.3.1] - 2018-02-12

- Added syntax highlighting for HTML style attribute
- Added hover for external component functions
- Added signature help for implicit getters/setters
- Added signature help for external component functions
- Added definitions for external component functions
- Added definitions for variables within templates

## [0.3.0] - 2018-01-22

- Added more ways to check context
- Added completions for external component functions
- Added completions for query properties
- Added completions for component dot-paths
- Added completions for enumerated values for global tag attributes
- Added completions for script global tags
- Added definition for arguments
- Added definition for local variables
- Added definition for inherited functions
- Added definition for application variables
- Added type definitions within components
- Added hover for global tag attributes
- Added hover for inherited functions
- Added signature help for inherited functions
- Added signature help for constructor when using `new` syntax
- Added variable parsing for for-in statements
- Added option `noImplicitReturns` to tsconfig
- Made some additional functions `async`
- Fixed some case sensitivity issues in CFML grammar/syntax
- Updated embedded syntaxes for HTML, CSS, JavaScript, and SQL

## [0.2.0] - 2017-11-29

- Update minimum version of VS Code to v1.18
- Added global definition filtering based on engine
- Improved type inference
- Changed signature format
- Argument type now indicates component name
- Improved syntax highlighting for properties
- Now able to ignore CFML comments
- Added variables assigned from tag attributes
- Added option `noUnusedLocals` to tsconfig

## [0.1.4] - 2017-11-13

- Added `cfcatch` help
- Improved attribute parsing
- Added param parsing
- Using new `MarkdownString` type where applicable
- Added hash (`#`) to `autoClosingPairs` and set syntax to have contents of hash pairs as embedded code where applicable

## [0.1.3] - 2017-10-05

- Added docblock completion
- Improved tag attribute name completion
- Minor syntax additions

## [0.1.2] - 2017-10-02

- Corrected checks for existence of certain other extensions

## [0.1.1] - 2017-10-02

- Corrected issue with CFLint running for all indexed files
- Fixed issue causing publication to fail

## [0.1.0] - 2017-10-01

- Initial release
