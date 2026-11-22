import { CancellationToken, Event, InlayHint, InlayHintKind, InlayHintsProvider, Position, Range, TextDocument, workspace } from "vscode";
import { objectNewInstanceInitPrefix } from "../entities/component";
import { Function, getScriptFunctionArgRanges } from "../entities/function";
import { getParameterName } from "../entities/parameter";
import { expressionCfmlTags } from "../entities/tag";
import { getFunctionFromPrefix, parseScriptFunctions, UserFunction } from "../entities/userFunction";
import { getCfScriptRanges, getNextCharacterPosition, isInRanges } from "../utils/contextUtil";
import { getDocumentStateContext, getPositionStateContext } from "../utils/documentUtil";
import { cachedComponentPathToUri, getComponent, getGlobalFunction } from "./cachedEntities";

const namedArgument = /^\s*[\w$]+\s*(?:=(?!=)|:(?!:))/;
const statementKeywords = new Set(["catch", "for", "function", "if", "return", "switch", "while"]);

export default class ParameterInlayHintsProvider implements InlayHintsProvider {
	public readonly onDidChangeInlayHints: Event<void> = (listener, thisArgs, disposables) =>
		workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration("cfml.inlayHints.parameterNames")) {
				listener.call(thisArgs);
			}
		}, undefined, disposables);

	/**
	 * Labels positional call arguments with names from their signatures.
	 * @param document The document containing the calls.
	 * @param range The requested range of hint positions.
	 * @param token The cancellation token.
	 * @returns The parameter hints within the range.
	 */
	public async provideInlayHints(document: TextDocument, range: Range, token: CancellationToken): Promise<InlayHint[]> {
		if (!workspace.getConfiguration("cfml.inlayHints", document.uri).get<boolean>("parameterNames", true)) {
			return [];
		}

		const state = await getDocumentStateContext(document, false, true, token);
		const text = state.sanitizedDocumentText;
		const fullDocument = new Range(new Position(0, 0), document.positionAt(text.length));
		const isScript = state.docIsScript;
		const scriptRanges = isScript ? [fullDocument] : getCfScriptRanges(document, undefined, token, state.commentRanges, true, range.end, true);
		const regions = scriptRanges.map(scriptRange => ({ range: scriptRange, isScript: true }));
		if (!isScript) {
			const expressionTagPattern = new RegExp("<(?:" + expressionCfmlTags.join("|") + ")\\b", "gi");
			for (const tag of text.slice(0, document.offsetAt(range.end)).matchAll(expressionTagPattern)) {
				const start = document.positionAt(tag.index);
				if (isInRanges(scriptRanges, start, false, token) || isInRanges(state.stringRanges ?? [], start, false, token)) {
					continue;
				}
				const bodyStart = tag.index + tag[0].length;
				const end = getNextCharacterPosition(state, bodyStart, text.length, ">", false, token);
				regions.push({ range: new Range(document.positionAt(bodyStart), end), isScript: false });
			}
		}

		const hints: InlayHint[] = [];
		let standaloneFunctions: UserFunction[] | undefined;
		for (const region of regions) {
			if (!region.range.intersection(range)) {
				continue;
			}
			const regionStart = document.offsetAt(region.range.start);
			const regionEnd = document.offsetAt(region.range.end);
			const scanEnd = Math.min(regionEnd, document.offsetAt(range.end));
			const scan = text.slice(regionStart, scanEnd);
			for (const match of scan.matchAll(/(?<![\w$])([a-z_$][\w$]*)\s*\(/gi)) {
				if (token.isCancellationRequested) {
					return [];
				}
				const name = match[1].toLowerCase();
				const position = document.positionAt(regionStart + match.index);
				if (statementKeywords.has(name) || isInRanges(state.stringRanges ?? [], position, false, token)) {
					continue;
				}
				const argsStart = regionStart + match.index + match[0].length;
				const end = getNextCharacterPosition(state, argsStart, regionEnd, ")", false, token);
				if (end.isBefore(range.start) || document.offsetAt(end) === regionEnd) {
					continue;
				}
				const args = getScriptFunctionArgRanges(state, new Range(document.positionAt(argsStart), end), ",", token).map((arg) => {
					const start = document.offsetAt(arg.start);
					const value = text.slice(start, document.offsetAt(arg.end));
					return { value, position: document.positionAt(start + value.length - value.trimStart().length) };
				});
				if (args.some(arg => !arg.value.trim()) || !args.some(arg => range.contains(arg.position) && !namedArgument.test(arg.value))) {
					continue;
				}

				const call = getPositionStateContext(state, position, region.isScript, token);
				if (/\bfunction\s*$/i.test(call.docPrefix)) {
					continue;
				}
				const constructor = objectNewInstanceInitPrefix.exec(call.docPrefix + match[0]);
				let entry: Function | undefined;
				if (constructor) {
					const uri = cachedComponentPathToUri(constructor[2].trim(), document.uri, token);
					const component = uri && getComponent(uri);
					entry = component?.functions.get(component.initmethod?.toLowerCase() || "init");
				}
				else {
					entry = (call.isContinuingExpression ? undefined : getGlobalFunction(name))
						?? await getFunctionFromPrefix(call, name, undefined, token);
					if (!entry && isScript && !state.isCfcFile && !call.isContinuingExpression) {
						standaloneFunctions ??= await parseScriptFunctions(state, token);
						entry = standaloneFunctions.find(func => func.name.toLowerCase() === name);
					}
				}
				const signatures = entry?.signatures.filter(signature => args.length <= signature.parameters.length
					&& args.length >= signature.parameters.filter(parameter => parameter.required).length);
				if (!signatures?.length) {
					continue;
				}
				for (const [index, arg] of args.entries()) {
					if (!range.contains(arg.position) || namedArgument.test(arg.value)) {
						continue;
					}
					const name = getParameterName(signatures[0].parameters[index]);
					if (name && signatures.every(signature => getParameterName(signature.parameters[index]).toLowerCase() === name.toLowerCase())) {
						const hint = new InlayHint(arg.position, name + ":", InlayHintKind.Parameter);
						hint.paddingRight = true;
						hints.push(hint);
					}
				}
			}
		}
		return hints;
	}
}
