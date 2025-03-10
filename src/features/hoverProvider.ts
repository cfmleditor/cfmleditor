import { CancellationToken, Hover, HoverProvider, MarkdownString, Position, Range, TextDocument, TextLine, Uri, workspace, WorkspaceConfiguration } from "vscode";
import { extensionContext, LANGUAGE_ID } from "../cfmlMain";
import { VALUE_PATTERN } from "../entities/attribute";
import { Component, COMPONENT_EXT, objectNewInstanceInitPrefix } from "../entities/component";
import { IPropertyData, IAtDirectiveData } from "../entities/css/cssLanguageTypes";
import { cssDataManager, getEntryDescription as getCSSEntryDescription, cssWordRegex } from "../entities/css/languageFacts";
import { cssPropertyPattern } from "../entities/css/property";
import { DataType } from "../entities/dataType";
import { constructSyntaxString, Function, getFunctionSuffixPattern } from "../entities/function";
import { GlobalFunction, GlobalTag, globalTagSyntaxToScript } from "../entities/globals";
import { ITagData as HTMLTagData } from "../entities/html/htmlLanguageTypes";
import { getTag as getHTMLTag, isKnownTag as isKnownHTMLTag } from "../entities/html/languageFacts";
import { constructParameterLabel, getParameterName, Parameter } from "../entities/parameter";
import { Signature } from "../entities/signature";
import { expressionCfmlTags, getCfScriptTagAttributePattern, getCfTagAttributePattern, getTagPrefixPattern } from "../entities/tag";
import { getFunctionFromPrefix, UserFunction } from "../entities/userFunction";
import { CFMLEngine, CFMLEngineName } from "../utils/cfdocs/cfmlEngine";
import { CFDocsDefinitionInfo, EngineCompatibilityDetail } from "../utils/cfdocs/definitionInfo";
import { MyMap, MySet } from "../utils/collections";
import { getCssRanges, isCfmFile } from "../utils/contextUtil";
import { DocumentPositionStateContext, getDocumentPositionStateContext } from "../utils/documentUtil";
import { equalsIgnoreCase, textToMarkdownCompatibleString, textToMarkdownString } from "../utils/textUtil";
import { isGlobalFunction, getGlobalFunction, getGlobalTag, isGlobalTag, cachedComponentPathToUri, getGlobalEntityDefinition } from "./cachedEntities";
import { getComponent } from "./cachedEntities";
import { uriBaseName } from "../utils/fileUtil";

const cfDocsLinkPrefix = "https://cfdocs.org/";
const mdnLinkPrefix = "https://developer.mozilla.org/docs/Web/";

interface HoverProviderItem {
	name: string;
	syntax: string;
	symbolType: string;
	description: string;
	params?: Parameter[];
	returnType?: string;
	genericDocLink?: string;
	engineLinks?: MyMap<CFMLEngineName, Uri>;
	language?: string;
}

export default class CFMLHoverProvider implements HoverProvider {
	/**
	 * Provides a hover for the given position and document
	 * @param document The document in which the hover was invoked.
	 * @param position The position at which the hover was invoked.
	 * @param _token A cancellation token.
	 * @returns
	 */
	public async provideHover(document: TextDocument, position: Position, _token: CancellationToken | undefined): Promise<Hover | undefined> {
		const cfmlHoverSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.hover", document.uri);
		if (!cfmlHoverSettings.get<boolean>("enable", true)) {
			return undefined;
		}

		const filePath: string = document.fileName;
		if (!filePath) {
			return undefined;
		}

		return this.getHover(document, position, _token);
	}

	/**
	 * Generates hover
	 * @param document The document in which the hover was invoked.
	 * @param position The position at which the hover was invoked.
	 * @param _token
	 * @returns
	 */
	public async getHover(document: TextDocument, position: Position, _token: CancellationToken | undefined): Promise<Hover | undefined> {
		const wordRange: Range | undefined = document.getWordRangeAtPosition(position);

		if (!wordRange) {
			return undefined;
		}

		// console.log("getHover:CFMLHoverProvider:" + _token?.isCancellationRequested);

		let definition: HoverProviderItem | undefined;
		const cfmlCompletionSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.suggest", document.uri);
		const replaceComments = cfmlCompletionSettings.get<boolean>("replaceComments", true);
		const documentPositionStateContext: DocumentPositionStateContext = getDocumentPositionStateContext(document, position, false, replaceComments, _token, true);
		const userEngine: CFMLEngine = documentPositionStateContext.userEngine;
		const textLine: TextLine = document.lineAt(position);
		const lineText: string = documentPositionStateContext.sanitizedDocumentText.slice(document.offsetAt(textLine.range.start), document.offsetAt(textLine.range.end));
		const currentWord: string = documentPositionStateContext.currentWord;
		const lowerCurrentWord = currentWord.toLowerCase();
		const lineSuffix: string = lineText.slice(wordRange.end.character, textLine.range.end.character);
		const docPrefix: string = documentPositionStateContext.docPrefix;
		const positionIsCfScript: boolean = documentPositionStateContext.positionIsScript;

		let userFunc: UserFunction | undefined;

		const tagPrefixPattern: RegExp = getTagPrefixPattern();
		const functionSuffixPattern: RegExp = getFunctionSuffixPattern();

		if (documentPositionStateContext.positionInComment) {
			return undefined;
		}

		// Global tags
		if (isGlobalTag(currentWord)) {
			if (tagPrefixPattern.test(docPrefix)) {
				definition = this.globalTagToHoverProviderItem(getGlobalTag(lowerCurrentWord));
				return this.createHover(definition);
			}

			if (userEngine.supportsScriptTags() && functionSuffixPattern.test(lineSuffix)) {
				definition = this.globalTagToHoverProviderItem(getGlobalTag(lowerCurrentWord), true);
				return this.createHover(definition);
			}
		}

		// Check if instantiating via "new" operator
		const componentPathWordRange: Range | undefined = document.getWordRangeAtPosition(position, /[$\w.]+/);
		if (componentPathWordRange) {
			const componentPathWord: string = document.getText(componentPathWordRange);
			const componentPathWordPrefix: string = documentPositionStateContext.sanitizedDocumentText.slice(0, document.offsetAt(componentPathWordRange.start));
			const startSigPositionPrefix = `${componentPathWordPrefix}${componentPathWord}(`;
			const objectNewInstanceInitPrefixMatch: RegExpExecArray | null = objectNewInstanceInitPrefix.exec(startSigPositionPrefix);
			if (objectNewInstanceInitPrefixMatch && objectNewInstanceInitPrefixMatch[2] === componentPathWord) {
				const componentUri: Uri | undefined = cachedComponentPathToUri(componentPathWord, document.uri, _token);
				if (componentUri) {
					const initComponent: Component | undefined = getComponent(componentUri, _token);
					if (initComponent) {
						const initMethod = initComponent.initmethod ? initComponent.initmethod.toLowerCase() : "init";
						if (initComponent.functions.has(initMethod)) {
							userFunc = initComponent.functions.get(initMethod);
							if (userFunc) {
								definition = this.functionToHoverProviderItem(userFunc);
								if (definition) {
									return this.createHover(definition, componentPathWordRange);
								}
							}
						}
					}
				}
			}
		}

		// Functions
		if (functionSuffixPattern.test(lineSuffix)) {
			// Global function
			if (!documentPositionStateContext.isContinuingExpression && isGlobalFunction(currentWord)) {
				definition = this.functionToHoverProviderItem(getGlobalFunction(lowerCurrentWord));
				return this.createHover(definition);
			}

			// User function
			userFunc = await getFunctionFromPrefix(documentPositionStateContext, lowerCurrentWord, undefined, _token);
			if (userFunc) {
				definition = this.functionToHoverProviderItem(userFunc);
				return this.createHover(definition);
			}
		}

		// Global tag attributes
		if (!positionIsCfScript || userEngine.supportsScriptTags()) {
			const cfTagAttributePattern: RegExp = positionIsCfScript ? getCfScriptTagAttributePattern() : getCfTagAttributePattern();
			const cfTagAttributeMatch: RegExpExecArray | null = cfTagAttributePattern.exec(docPrefix);
			if (cfTagAttributeMatch) {
				const ignoredTags: string[] = expressionCfmlTags;
				const tagName: string = cfTagAttributeMatch[2];
				const globalTag: GlobalTag = getGlobalTag(tagName);
				const attributeValueMatch: RegExpExecArray | null = VALUE_PATTERN.exec(docPrefix);
				if (globalTag && !ignoredTags.includes(globalTag.name) && !attributeValueMatch) {
					// TODO: Check valid attribute before calling createHover
					definition = this.attributeToHoverProviderItem(globalTag, currentWord);
					if (definition) {
						return this.createHover(definition);
					}
				}
			}
		}

		// TODO: Function arguments used within function body, or named argument invocation. Component properties.

		// HTML tags
		const htmlHoverSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.hover.html", document.uri);
		if (isCfmFile(document, _token) && htmlHoverSettings.get<boolean>("enable", true) && tagPrefixPattern.test(docPrefix) && isKnownHTMLTag(lowerCurrentWord)) {
			const htmlTag: HTMLTagData | undefined = getHTMLTag(lowerCurrentWord);
			if (htmlTag) {
				definition = this.htmlTagToHoverProviderItem(htmlTag);
				if (definition) {
					return this.createHover(definition);
				}
			}
		}

		// CSS
		const cssHoverSettings: WorkspaceConfiguration = workspace.getConfiguration("cfml.hover.css", document.uri);
		const cssRanges: Range[] = getCssRanges(documentPositionStateContext, undefined, _token);
		if (cssHoverSettings.get<boolean>("enable", true)) {
			for (const cssRange of cssRanges) {
				if (!cssRange.contains(position)) {
					continue;
				}

				const rangeTextOffset: number = document.offsetAt(cssRange.start);
				const rangeText: string = documentPositionStateContext.sanitizedDocumentText.slice(rangeTextOffset, document.offsetAt(cssRange.end));
				let propertyMatch: RegExpExecArray | null;
				while ((propertyMatch = cssPropertyPattern.exec(rangeText))) {
					const propertyName: string = propertyMatch[2];

					const propertyRange: Range = new Range(
						document.positionAt(rangeTextOffset + propertyMatch.index),
						document.positionAt(rangeTextOffset + propertyMatch.index + propertyMatch[0].length)
					);

					if (propertyRange.contains(position) && cssDataManager.isKnownProperty(propertyName)) {
						const cssProperty: IPropertyData | undefined = cssDataManager.getProperty(propertyName);
						if (cssProperty) {
							definition = this.cssPropertyToHoverProviderItem(cssProperty);
							return this.createHover(definition, propertyRange);
						}
					}
				}

				const cssWordRange: Range | undefined = document.getWordRangeAtPosition(position, cssWordRegex);
				const currentCssWord: string = cssWordRange ? document.getText(cssWordRange) : "";

				if (currentCssWord.startsWith("@")) {
					const cssAtDir: IAtDirectiveData | undefined = cssDataManager.getAtDirective(currentCssWord);
					if (cssAtDir) {
						definition = this.cssAtDirectiveToHoverProviderItem(cssAtDir);
						return this.createHover(definition, cssWordRange);
					}
				}
			}
		}

		return undefined;
	}

	/**
	 * Creates HoverProviderItem from given global tag
	 * @param tag Global tag to convert
	 * @param isScript Whether this is a script tag
	 * @returns
	 */
	public globalTagToHoverProviderItem(tag: GlobalTag, isScript: boolean = false): HoverProviderItem {
		const paramArr: Parameter[] = [];
		const paramNames = new MySet<string>();

		tag.signatures.forEach((sig: Signature) => {
			sig.parameters.forEach((param: Parameter) => {
				const paramName = getParameterName(param);
				if (!paramNames.has(paramName)) {
					paramNames.add(paramName);
					paramArr.push(param);
				}
			});
		});

		const hoverItem: HoverProviderItem = {
			name: tag.name,
			syntax: (isScript ? globalTagSyntaxToScript(tag) : tag.syntax),
			symbolType: "tag",
			description: tag.description,
			params: paramArr,
			returnType: undefined,
			genericDocLink: cfDocsLinkPrefix + tag.name,
			language: LANGUAGE_ID,
		};

		const globalEntity: CFDocsDefinitionInfo | undefined = getGlobalEntityDefinition(tag.name);
		if (globalEntity && globalEntity.engines) {
			hoverItem.engineLinks = new MyMap();
			const cfmlEngineNames: CFMLEngineName[] = [
				CFMLEngineName.ColdFusion,
				CFMLEngineName.Lucee,
				CFMLEngineName.OpenBD,
			];

			for (const cfmlEngineName of cfmlEngineNames) {
				if (Object.prototype.hasOwnProperty.call(globalEntity.engines, cfmlEngineName)) {
					const cfEngineInfo: EngineCompatibilityDetail = globalEntity.engines[cfmlEngineName];
					if (cfEngineInfo.docs) {
						try {
							const engineDocUri: Uri = Uri.parse(cfEngineInfo.docs);
							hoverItem.engineLinks.set(CFMLEngineName.valueOf(cfmlEngineName), engineDocUri);
						}
						catch (ex) {
							console.warn(ex);
						}
					}
				}
			}
		}

		return hoverItem;
	}

	/**
	 * Creates HoverProviderItem from given function
	 * @param func Function to convert
	 * @returns
	 */
	public functionToHoverProviderItem(func: Function): HoverProviderItem {
		const paramArr: Parameter[] = [];
		const paramNames = new MySet<string>();
		func.signatures.forEach((sig: Signature) => {
			sig.parameters.forEach((param: Parameter) => {
				const paramName = getParameterName(param);
				if (!paramNames.has(paramName)) {
					paramNames.add(paramName);
					paramArr.push(param);
				}
			});
		});

		let returnType: string | undefined;
		if ("returnTypeUri" in func) {
			const userFunction: UserFunction = func as UserFunction;
			if (userFunction.returnTypeUri) {
				returnType = uriBaseName(userFunction.returnTypeUri, COMPONENT_EXT);
			}
		}

		if (!returnType && func.returntype) {
			returnType = func.returntype;
		}
		else {
			returnType = DataType.Any;
		}

		const hoverItem: HoverProviderItem = {
			name: func.name,
			syntax: constructSyntaxString(func),
			symbolType: "function",
			description: func.description,
			params: paramArr,
			returnType: returnType,
		};

		if (isGlobalFunction(func.name)) {
			const globalFunc = func as GlobalFunction;
			// TODO: Use constructed syntax string instead. Indicate overloads/multiple signatures
			hoverItem.syntax = globalFunc.syntax + ": " + returnType;
			hoverItem.genericDocLink = cfDocsLinkPrefix + globalFunc.name;

			const globalEntity: CFDocsDefinitionInfo | undefined = getGlobalEntityDefinition(globalFunc.name);
			if (globalEntity && globalEntity.engines) {
				hoverItem.engineLinks = new MyMap();
				const cfmlEngineNames: CFMLEngineName[] = [
					CFMLEngineName.ColdFusion,
					CFMLEngineName.Lucee,
					CFMLEngineName.OpenBD,
				];

				for (const cfmlEngineName of cfmlEngineNames) {
					if (Object.prototype.hasOwnProperty.call(globalEntity.engines, cfmlEngineName)) {
						const cfEngineInfo: EngineCompatibilityDetail = globalEntity.engines[cfmlEngineName];
						if (cfEngineInfo.docs) {
							try {
								const engineDocUri: Uri = Uri.parse(cfEngineInfo.docs);
								hoverItem.engineLinks.set(CFMLEngineName.valueOf(cfmlEngineName), engineDocUri);
							}
							catch (ex) {
								console.warn(ex);
							}
						}
					}
				}
			}
		}

		return hoverItem;
	}

	/**
	 * Creates HoverProviderItem from given global tag attribute
	 * @param tag Global tag to which the attribute belongs
	 * @param attributeName Global tag attribute name to convert
	 * @returns
	 */
	public attributeToHoverProviderItem(tag: GlobalTag, attributeName: string): HoverProviderItem | undefined {
		let attribute: Parameter | undefined;

		tag.signatures.forEach((sig: Signature) => {
			attribute = sig.parameters.find((param: Parameter) => {
				const paramName = getParameterName(param);
				return equalsIgnoreCase(paramName, attributeName);
			});
		});

		if (!attribute) {
			return undefined;
		}

		return {
			name: attributeName,
			syntax: `${attribute.required ? "(required) " : ""}${tag.name}[@${attributeName}]: ${attribute.dataType}`,
			symbolType: "attribute",
			description: attribute.description,
			genericDocLink: `${cfDocsLinkPrefix}${tag.name}#p-${attribute.name}`,
		};
	}

	/**
	 * Creates HoverProviderItem from given HTML tag
	 * @param htmlTag HTML tag to convert
	 * @returns
	 */
	public htmlTagToHoverProviderItem(htmlTag: HTMLTagData): HoverProviderItem {
		const hoverItem: HoverProviderItem = {
			name: htmlTag.name,
			syntax: `<${htmlTag.name}>`,
			symbolType: "tag",
			description: htmlTag.description || "",
			params: [],
			returnType: undefined,
			genericDocLink: `${mdnLinkPrefix}HTML/Element/${htmlTag.name}`,
			language: "html",
		};

		return hoverItem;
	}

	/**
	 * Creates HoverProviderItem from given CSS property
	 * @param cssProperty CSS property to convert
	 * @returns
	 */
	public cssPropertyToHoverProviderItem(cssProperty: IPropertyData): HoverProviderItem {
		const hoverItem: HoverProviderItem = {
			name: cssProperty.name,
			syntax: `${cssProperty.name}: value`,
			symbolType: "property",
			description: getCSSEntryDescription(cssProperty) || "",
			params: [],
			returnType: undefined,
			genericDocLink: `${mdnLinkPrefix}CSS/${cssProperty.name}`,
		};

		if (cssProperty.syntax) {
			hoverItem.syntax = `${cssProperty.name}: ${cssProperty.syntax}`;
		}

		return hoverItem;
	}

	/**
	 * Creates HoverProviderItem from given CSS at directive
	 * @param cssAtDir CSS at directive to convert
	 * @returns
	 */
	public cssAtDirectiveToHoverProviderItem(cssAtDir: IAtDirectiveData): HoverProviderItem {
		const hoverItem: HoverProviderItem = {
			name: cssAtDir.name,
			syntax: cssAtDir.name,
			symbolType: "property",
			description: getCSSEntryDescription(cssAtDir) || "",
			params: [],
			returnType: undefined,
			genericDocLink: `${mdnLinkPrefix}CSS/${cssAtDir.name.replace(/-[a-z]+-/, "")}`,
			language: "css",
		};

		return hoverItem;
	}

	/**
	 * Creates a list of MarkdownString that becomes the hover based on the symbol definition
	 * @param definition The symbol definition information
	 * @param range An optional range to which this hover applies
	 * @returns
	 */
	public createHover(definition: HoverProviderItem, range?: Range): Hover | undefined {
		if (!definition) {
			throw new Error("Definition not found");
		}

		if (!definition.name) {
			throw new Error("Invalid definition format");
		}

		const hoverText: MarkdownString[] | undefined = this.createHoverText(definition);
		if (hoverText) {
			return new Hover(hoverText, range);
		}
		else {
			return undefined;
		}
	}

	/**
	 * Creates a list of MarkdownString that becomes the hover text based on the symbol definition
	 * @param definition The symbol definition information
	 * @returns
	 */
	public createHoverText(definition: HoverProviderItem): MarkdownString[] | undefined {
		const cfdocsIconUri: Uri = Uri.file(extensionContext.asAbsolutePath("images/cfdocs.png"));
		const mdnIconUri: Uri = Uri.file(extensionContext.asAbsolutePath("images/mdn.png"));

		const hoverTexts: MarkdownString[] = [];
		let syntax: string = definition.syntax;

		const symbolType: string = definition.symbolType;
		let language: string = "plaintext";
		// let paramKind = "";
		if (symbolType === "function") {
			if (!syntax.startsWith("function ")) {
				syntax = "function " + syntax;
			}

			language = definition.language ? definition.language : "typescript"; // cfml not coloring properly
			// paramKind = "Parameter";
		}
		else if (symbolType === "tag") {
			language = definition.language ? definition.language : LANGUAGE_ID;
			// paramKind = "Attribute";
		}
		else if (symbolType === "attribute") {
			language = definition.language ? definition.language : "typescript";
		}
		else if (symbolType === "property") {
			if (definition.language) {
				language = definition.language;
			}
		}
		else {
			return undefined;
		}

		hoverTexts.push(new MarkdownString().appendCodeblock(syntax, language));

		if (definition.description) {
			hoverTexts.push(textToMarkdownString(definition.description));
		}
		else {
			hoverTexts.push(new MarkdownString("_No " + symbolType.toLowerCase() + " description_"));
		}

		if (definition.genericDocLink) {
			let docLinks: string = "";
			if (definition.genericDocLink.startsWith(cfDocsLinkPrefix)) {
				docLinks = `[![cfdocs](${cfdocsIconUri.toString()})](${definition.genericDocLink})`;
				if (definition.engineLinks) {
					definition.engineLinks.forEach((docUri: Uri, engineName: CFMLEngineName) => {
						const engineIconUri = CFMLEngine.getIconUri(engineName);
						if (engineIconUri) {
							docLinks += `  &nbsp;&nbsp;[![${engineName}](${engineIconUri.toString()})](${docUri.toString()})`;
						}
					});
				}
			}
			else if (definition.genericDocLink.startsWith(mdnLinkPrefix)) {
				docLinks = `[![mdn](${mdnIconUri.toString()})](${definition.genericDocLink})`;
			}

			hoverTexts.push(new MarkdownString(docLinks));
		}

		const paramList: Parameter[] | undefined = definition.params;
		if (paramList && paramList.length > 0) {
			hoverTexts.push(this.paramsMarkdownPreview(paramList));
		}

		return hoverTexts;
	}

	public paramsMarkdownPreview(params: Parameter[], isVerbose: boolean = true): MarkdownString {
		const paramDocFunction: (param: Parameter) => string = isVerbose ? this.getVerboseParamDocumentation.bind(this) : this.getParamDocumentation.bind(this);

		return new MarkdownString(params.map(paramDocFunction).join("  \n\n"));
	}

	public getParamDocumentation(param: Parameter): string {
		const paramName = getParameterName(param);
		const doc = param.description;
		const label = `\`${paramName}\``;
		if (!doc) {
			return label;
		}

		return label + (/\n/.test(doc) ? "  \n" + doc : ` — ${doc}`);
	}

	public getVerboseParamDocumentation(param: Parameter): string {
		let paramString = constructParameterLabel(param);

		if (!param.required && typeof param.default !== "undefined") {
			let paramDefault = param.default;
			// TODO: Improve check
			if (typeof paramDefault === "string") {
				if (param.dataType === DataType.String) {
					if (!paramDefault.trim().startsWith("'") && !paramDefault.trim().startsWith("\"")) {
						paramDefault = `"${paramDefault.trim()}"`;
					}
				}
				else if (param.dataType === DataType.Numeric) {
					paramDefault = paramDefault.replace(/['"]/, "").trim();
				}
				else if (param.dataType === DataType.Boolean) {
					paramDefault = DataType.isTruthy(paramDefault).toString();
				}
			}

			if (paramDefault) {
				paramString += " = " + paramDefault;
			}
		}

		const hoverText = new MarkdownString(`\`${paramString}\``).appendMarkdown("  \n&nbsp;");

		if (param.description) {
			hoverText.appendMarkdown(textToMarkdownCompatibleString(param.description));
		}
		else {
			hoverText.appendMarkdown("_No description_");
		}

		return hoverText.value;
	}
}
