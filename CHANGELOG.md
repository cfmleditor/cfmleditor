# Change Log

All notable changes to the CFML extension will be documented in this file.

## [0.6.33] - 2025-02-18

- Replace trie-prefix-tree with trie-search and simplify search implementation for user defined functions #41 ( fixes issues with $ in function name )
- Fix Inefficient Regular Expression Complexity in koa - https://github.com/advisories/GHSA-593f-38f6-jp5m
- Add support for cfscript tag islands

## [0.6.32] - 2025-02-17

- Use fast textdocument for caching PR #40 @pixilation - improves the performance of the CFML: Refresh cache for workspace definitions command that runs on startup. This is the "Caching components" progress meter that appears.
- Bump packages (semver, vscode-uri, @vscode/vsce)

## [0.6.31] - 2025-01-22

- Bump dependencies

## [0.6.30] - 2024-09-18

- Fix for https://github.com/cfmleditor/cfmleditor/issues/33

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
