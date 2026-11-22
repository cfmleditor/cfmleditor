import { window } from "vscode";

// The browser extension host cannot launch a native language server.
export const supportsNativeLsp = false;
export const startLspClient = (): Promise<void> => Promise.resolve();
export const stopLspClient = (): Promise<void> => Promise.resolve();
export const isLspRunning = (): boolean => false;
export const executeLspCommand = (): Promise<undefined> => Promise.resolve(undefined);
export const restartLspClient = (): Promise<void> => {
	void window.showInformationMessage("The native CFML language server is unavailable in the web extension.");
	return Promise.resolve();
};
