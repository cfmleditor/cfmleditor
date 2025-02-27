import { Range, Position, TextDocument } from "vscode";
import { Doc } from "./doc";
import { Component } from "../../entities/component";
import { getComponent } from "../cachedEntities";

/**
 * Represents a potential code block.
 *
 * This abstract class serves as a base class that includes
 * helpers for dealing with blocks of code and has the basic interface
 * for working with the documenter object
 */
export abstract class Block {
	/**
	 * Regex pattern for the block declaration match
	 */
	protected pattern: RegExp | undefined;

	/**
	 * The position of the starting signature
	 */
	protected position: Position;

	/**
	 * Text document which we'll need to do things like
	 * get text and ranges and things between ranges
	 */
	protected document: TextDocument;

	/**
	 * The whole signature string ready for parsing
	 */
	protected suffix: string | undefined;

	/**
	 * The component object
	 */
	protected component: Component | undefined;

	/**
	 * Creates an instance of Block.
	 * @param position The current position from which the DocBlock will be inserted
	 * @param document The document object in which the DocBlock is being created
	 */
	public constructor(position: Position, document: TextDocument) {
		this.position = position;
		this.document = document;
		this.setSuffix(document.getText(new Range(position, document.positionAt(document.getText().length))));
	}

	public setup(): void {
		this.component = getComponent(this.document.uri, undefined);
	}

	/**
	 * Set the suffix text.
	 * @param suffix The document text that occurs after this.position
	 * @returns this
	 */
	public setSuffix(suffix: string): Block {
		this.suffix = suffix;
		return this;
	}

	/**
	 * This should be a simple test to determine whether this matches
	 * our intended block declaration and we can proceed to properly
	 * document
	 * @returns regex / pattern test result
	 */
	public test(): boolean {
		if (this.pattern && this.suffix) {
			return this.pattern.test(this.suffix);
		}
		else {
			return false;
		}
	}

	/**
	 * This is where we parse the code block into a Doc
	 * object which represents our snippet
	 */
	public abstract constructDoc(): Doc;
}
