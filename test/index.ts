import path from "node:path";

import { glob } from "glob";
import Mocha from "mocha";

/**
 * !: must be synchronized
 * @param testsRoot
 * @param cb
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function run(testsRoot: string, cb: (error: any, failures?: number) => void): void {
	const mocha = new Mocha({ color: true });

	glob("**/suite/**.test.js", { cwd: testsRoot })
		.then((files) => {
			for (const f of files) {
				mocha.addFile(path.resolve(testsRoot, f));
			}

			try {
				mocha.run((failures) => {
					cb(null, failures);
				});
			}
			catch (error) {
				cb(error);
			}
		})
		.catch(error => cb(error));
}
