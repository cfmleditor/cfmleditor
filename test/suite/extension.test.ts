import { ok } from 'node:assert';

import vscode from 'vscode';

describe('#test extension', () => {

	const extension: vscode.Extension<unknown> | undefined = vscode.extensions.getExtension('cfmleditor.cfmleditor');

    before(() => {
        vscode.window.showInformationMessage('Test begin!');
    });

    it('1. extension should be present', () => {
		ok(extension);
    });

    after(() => {
        vscode.window.showInformationMessage('Test end!');
    });
});