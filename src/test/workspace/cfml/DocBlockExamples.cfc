component {
	/**
	 * Builds a gizmo.
	 *
	 * Inputs:
	 * - Template
	 * - Line number
	 *
	 * Indented example:
	 *
	 *     if (example("template.cfm", 42)) {
	 *         // Do something
	 *     }
	 *
	 * ```cfml
	 *     writeOutput("example");
	 * @example inside the fence
	 * ```
	 * @param template [required]
The template string to be used.
	 * @param {numeric} line - The line number.
	 * @returns cfscript.Gizmo The new gizmo.
	 */
	function buildDocumentedGizmo(required string template, numeric line) {
		return new cfscript.Gizmo();
	}

	/** @return True when enabled. */
	boolean function isDocumentedGizmoEnabled() {
		return true;
	}

	/**
	    Additional prose.
	    @hint Preferred hint.
	    @label.hint Legacy name-based argument hint.
	    @param label Fallback parameter text.
	    @returns {numeric} An example documented return.
	    */
	string function describeDocumentedLabel(string label) {
		return arguments.label;
	}

	function useExamples() {
		this.buildDocumentedGizmo("template.cfm", 42);
		this.isDocumentedGizmoEnabled();
		this.describeDocumentedLabel("label");
	}
}
