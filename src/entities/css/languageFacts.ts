/** Adopted from https://github.com/Microsoft/vscode-css-languageservice/blob/27f369f0d527b1952689e223960f779e89457374/src/languageFacts/index.ts */

import { EntryStatus, ICSSDataManager, IEntry } from "./cssLanguageTypes";
import { colors } from "./colors";

import { CSSDataManager } from "./dataManager";

export const cssWordRegex: RegExp = /(#?-?\d*\.\d\w*%?)|(::?[\w-]*(?=[^,{;]*[,{]))|(([@#.!])?[\w-?]+%?|[@#!.])/;

export const cssDataManager: ICSSDataManager = new CSSDataManager({

});

export const cssColors: { [name: string]: string } = colors;

function getEntryStatus(status: EntryStatus): string {
  switch (status) {
    case "experimental":
      return "⚠️ Property is experimental. Be cautious when using it.\n\n";
    case "nonstandard":
      return "🚨️ Property is nonstandard. Avoid using it.\n\n";
    case "obsolete":
      return "🚨️️️ Property is obsolete. Avoid using it.\n\n";
    default:
      return "";
  }
}

/**
 * Constructs a description for the given CSS entry
 * @param entry A CSS entry object
 * @returns
 */
export function getEntryDescription(entry: IEntry): string | null {
  if (!entry.description || entry.description === "") {
    return null;
  }

  let result: string = "";

  if (entry.status) {
    result += getEntryStatus(entry.status);
  }

  result += entry.description;

  const browserLabel = getBrowserLabel(entry.browsers);
  if (browserLabel) {
    result += `\n(${browserLabel})`;
  }

  /*
  if ("syntax" in entry) {
    result += `\n\nSyntax: ${entry.syntax}`;
  }
  */

  return result;
}

export interface Browsers {
	E?: string;
	FF?: string;
	IE?: string;
	O?: string;
	C?: string;
	S?: string;
	count: number;
	all: boolean;
	onCodeComplete: boolean;
}

export const browserNames = {
	E: 'Edge',
	FF: 'Firefox',
	S: 'Safari',
	C: 'Chrome',
	IE: 'IE',
	O: 'Opera'
};

/**
 *
 * @param browsers
 * @returns
 */
export function getBrowserLabel(browsers: string[] = []): string | null {
	if (browsers.length === 0) {
		return null;
	}

	return browsers
		.map(b => {
			let result = '';
			const matches = b.match(/([A-Z]+)(\d+)?/)!;

			const name = matches[1];
			const version = matches[2];

			if (name in browserNames) {
				result += browserNames[name as keyof typeof browserNames];
			}
			if (version) {
				result += ' ' + version;
			}
			return result;
		})
		.join(', ');
}