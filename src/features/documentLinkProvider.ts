
import { CancellationToken, DocumentLink, DocumentLinkProvider, FileStat, FileType, Position, Range, TextDocument, Uri, workspace, WorkspaceFolder } from "vscode";
import { isUri } from "../utils/textUtil";
import { uriExists, uriStat } from "../utils/fileUtil";
import { Utils } from "vscode-uri";

export default class CFMLDocumentLinkProvider implements DocumentLinkProvider {

  private linkPatterns: LinkPattern[] = [
    // attribute/value link
    {
      pattern: /\b(href|src|template|action|url)\s*(?:=|:|\()\s*(['"])((?!read|write|cfml2wddx|wddx2cfml|begin|commit|rollback|move|upload|zip|add|edit|create|captcha)[^'"#]+?)\2/gi,
      linkIndex: 3
    },
    // include script
    {
      pattern: /\binclude\s+(['"])([^'"]+?)\1/gi,
      linkIndex: 2
    },
  ];

  /**
   * Provide links for the given document.
   * @param document The document in which the links are located.
   * @param _token A cancellation token.
   * @returns
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async provideDocumentLinks(document: TextDocument, _token: CancellationToken): Promise<DocumentLink[]> {

    // console.log("provideDocumentLinks:CFMLDocumentLinkProvider:" + _token?.isCancellationRequested);

    const results: DocumentLink[] = [];
    const documentText: string = document.getText();

    let match: RegExpExecArray | null;

    for (const element of this.linkPatterns) {
      const pattern: RegExp = element.pattern;
      while ((match = pattern.exec(documentText))) {
        const link: string = match[element.linkIndex];
        const preLen: number = match[0].indexOf(link);
        const offset: number = (match.index || 0) + preLen;
        const linkStart: Position = document.positionAt(offset);
        const linkEnd: Position = document.positionAt(offset + link.length);
        try {
          const target: Uri | undefined = await this.resolveLink(document, link);
          if (target) {
            results.push(
              new DocumentLink(
                new Range(linkStart, linkEnd),
                target
              )
            );
          }
        } catch (e) {
          // noop
          console.error(e);
        }
      }
    }

    return results;
  }

  /**
   * Resolves given link text within a given document to a URI
   * @param document The document containing link text
   * @param link The link text to resolve
   * @returns
   */
  private async resolveLink(document: TextDocument, link: string): Promise<Uri | undefined> {
    if (link.startsWith("#")) {
      return undefined;
    }

    // Check for URI
    if (isUri(link)) {
      try {
        const uri: Uri = Uri.parse(link);
        if (uri.scheme) {
          return uri;
        }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (e) {
        // noop
      }
    }

    // Check for relative local file
    let linkPath: string = link.split(/[?#]/)[0];
    linkPath = linkPath.replace(/\\/,'/');
    let resourcePath: Uri | undefined = undefined;
    if (linkPath && linkPath[0] === "/") {
      // Relative to root
      const root: WorkspaceFolder | undefined = workspace.getWorkspaceFolder(document.uri);
      if (root) {
        resourcePath = Uri.joinPath(root.uri, linkPath);
      }
    } else {
      // Relative to document location
      const base: Uri = Utils.dirname(document.uri);
      resourcePath = Uri.joinPath(base, linkPath);
    }

    // Check custom virtual directories?
    if (resourcePath && await uriExists(resourcePath) ) {
        const fileStat: FileStat = await uriStat(resourcePath);
        if ( fileStat.type === FileType.File ) {
            return resourcePath;
        }
    }

    return undefined;
  }
}

interface LinkPattern {
  pattern: RegExp;
  linkIndex: number;
}
