import { languages, Position, Range, TextDocument, workspace } from "vscode";

const scriptDeclaration = /^(?:\s|\/\/[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/)*(?:component|interface)\s*(?:\{|\b(?:extends|implements|accessors|output)\s*=)/i;
const cfmlTag = /<\/?cf(?:_|(?:abort|argument|component|else|elseif|function|http|if|include|interface|loop|module|output|param|query|return|script|set|try)(?=[\s/>]|$))|<!---|<\/?cf$/i;
const detecting = new WeakSet<TextDocument>();

/**
 * Detects CFML syntax in an untitled plain-text editor.
 * @param document The editor document to inspect.
 */
export async function detectUntitledLanguage(document: TextDocument): Promise<void> {
	if (!document.isUntitled || document.languageId !== "plaintext" || document.isClosed || detecting.has(document)) {
		return;
	}
	if (workspace.getConfiguration("files", document).get<string>("defaultLanguage")
		|| !workspace.getConfiguration("cfml", document).get<boolean>("untitledLanguageDetection.enable", true)) {
		return;
	}

	const text = document.getText(new Range(new Position(0, 0), document.positionAt(8192)));
	const isScript = scriptDeclaration.test(text);
	const isTemplate = /^\s*</.test(text) && cfmlTag.test(text);
	if (!isScript && !isTemplate) {
		return;
	}

	detecting.add(document);
	try {
		await languages.setTextDocumentLanguage(document, isScript ? "cfs" : "cfml");
	}
	catch (error) {
		if (!document.isClosed) {
			console.warn("CFML Editor could not set the language of an untitled editor", error);
		}
	}
	finally {
		detecting.delete(document);
	}
}
