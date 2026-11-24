/**
 * Whether a `{` opens a struct literal rather than a block, judged by what comes before it:
 * a value position (after `=`, `(`, `,`, `[`, `:`, `?`, `&`, `return`) means a literal.
 * An assignment straight after such a brace, like `{ a = 1 }`, is a struct key, not a variable.
 * @param text The text containing the brace
 * @param braceOffset The offset of the `{`
 * @returns
 */
export function isStructLiteralBrace(text: string, braceOffset: number): boolean {
	const before = text.slice(0, braceOffset).trimEnd();

	// `case x: {` and `default: {` end in a colon but open a block
	if (/\b(?:case\s+[^;{}]+?|default\s*):$/i.test(before)) {
		return false;
	}

	return /(?:[=(,[:?&]|\breturn)$/i.test(before);
}
