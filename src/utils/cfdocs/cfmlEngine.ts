import { valid, eq, lt, lte, gt, gte, clean, coerce } from "semver";
import { Uri } from "vscode";
import { extensionContext } from "../../cfmlMain";

export enum CFMLEngineName {
	ColdFusion = "coldfusion",
	Lucee = "lucee",
	Railo = "railo",
	Unknown = "unknown",
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CFMLEngineName {
	/**
	 * Resolves a string value of name to an enumeration member
	 * @param name The name string to resolve
	 * @returns
	 */
	export function valueOf(name: string): CFMLEngineName {
		switch (name.toLowerCase()) {
			case "coldfusion":
				return CFMLEngineName.ColdFusion;
			case "lucee":
				return CFMLEngineName.Lucee;
			case "railo":
				return CFMLEngineName.Railo;
			default:
				return CFMLEngineName.Unknown;
		}
	}
}

export class CFMLEngine {
	private name: CFMLEngineName;
	private version: string | undefined;

	/**
	 *
	 * @param name
	 * @param version
	 */
	constructor(name: CFMLEngineName, version: string | undefined) {
		this.name = name;
		if (version !== undefined && version !== "" && valid(version, true)) {
			this.version = valid(version, true) || undefined;
		}
		else {
			this.version = version ? CFMLEngine.toSemVer(version) : undefined;
		}
	}

	/**
	 * Getter for CFML engine name
	 * @returns
	 */
	public getName(): CFMLEngineName {
		return this.name;
	}

	/**
	 * Getter for CFML engine version
	 * @returns
	 */
	public getVersion(): string | undefined {
		return this.version;
	}

	/**
	 * Check if this engine is equal to `other`.
	 * @param other A CFML engine.
	 * @returns
	 */
	public equals(other: CFMLEngine): boolean {
		if (this.name === CFMLEngineName.Unknown || other.name === CFMLEngineName.Unknown) {
			return false;
		}

		if (this.name === other.name) {
			if (!this.version && !other.version) {
				return true;
			}
			else if (!this.version || !other.version) {
				return false;
			}
			else {
				return eq(this.version, other.version);
			}
		}

		return false;
	}

	/**
	 * Check if this engine is older than `other`. Returns undefined if they have different name.
	 * @param other A CFML engine.
	 * @returns
	 */
	public isOlder(other: CFMLEngine): boolean | undefined {
		if (this.name === CFMLEngineName.Unknown || other.name === CFMLEngineName.Unknown || this.name !== other.name || !this.version || !other.version) {
			return undefined;
		}
		return lt(this.version, other.version);
	}

	/**
	 * Check if this engine is older than or equals `other`. Returns undefined if they have different name.
	 * @param other A CFML engine.
	 * @returns
	 */
	public isOlderOrEquals(other: CFMLEngine): boolean | undefined {
		if (this.name === CFMLEngineName.Unknown || other.name === CFMLEngineName.Unknown || this.name !== other.name || !this.version || !other.version) {
			return undefined;
		}
		return lte(this.version, other.version);
	}

	/**
	 * Check if this engine is newer than `other`. Returns undefined if they have different name.
	 * @param other A CFML engine.
	 * @returns
	 */
	public isNewer(other: CFMLEngine): boolean | undefined {
		if (this.name === CFMLEngineName.Unknown || other.name === CFMLEngineName.Unknown || this.name !== other.name || !this.version || !other.version) {
			return undefined;
		}
		return gt(this.version, other.version);
	}

	/**
	 * Check if this engine is newer than or equals `other`. Returns undefined if they have different name.
	 * @param other A CFML engine.
	 * @returns
	 */
	public isNewerOrEquals(other: CFMLEngine): boolean | undefined {
		if (this.name === CFMLEngineName.Unknown || other.name === CFMLEngineName.Unknown || this.name !== other.name || !this.version || !other.version) {
			return undefined;
		}
		return gte(this.version, other.version);
	}

	/**
	 * Returns whether this engine supports tags in script format
	 * @returns
	 */
	public supportsScriptTags(): boolean {
		return (
			this.name === CFMLEngineName.Unknown
			|| (this.name === CFMLEngineName.ColdFusion && this.version && gte(this.version, "11.0.0"))
			|| this.name === CFMLEngineName.Lucee
			|| (this.name === CFMLEngineName.Railo && this.version && gte(this.version, "4.2.0"))
		)
			? true
			: false;
	}

	/**
	 * Returns whether this engine supports named parameters for global functions
	 * @returns
	 */
	public supportsGlobalFunctionNamedParams(): boolean {
		return (
			this.name === CFMLEngineName.Unknown
			|| (this.name === CFMLEngineName.ColdFusion && this.version && gte(this.version, "2018.0.0"))
			|| this.name === CFMLEngineName.Lucee
			|| (this.name === CFMLEngineName.Railo && this.version && gte(this.version, "3.3.0"))
		)
			? true
			: false;
	}

	/**
	 * Attempts to transform versionStr into a valid semver version
	 * @param versionStr A version string.
	 * @returns
	 */
	public static toSemVer(versionStr: string): string | undefined {
		if (versionStr !== "" && clean(versionStr, true)) {
			return clean(versionStr, true) || undefined;
		}
		return valid(coerce(versionStr)) || undefined;
	}

	/**
	 * Gets the CFML engine icon URI
	 * @param name CFMLEngineName
	 * @returns
	 */
	public static getIconUri(name: CFMLEngineName | "cfdocs" | "mdn"): Uri {
		return Uri.joinPath(extensionContext.extensionUri, `images/${name}.png`);
	}
}
