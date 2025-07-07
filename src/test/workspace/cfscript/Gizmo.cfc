component extends="cfscript.Base" {

	public cfscript.Gizmo function init(string name="") {
		variables.name = arguments.name;
		return this;
	}

	public cfscript.Gizmo fucntion compareTo(cfscript.Gizmo gizmo) {
		return compare(variables.name, gizmo.name);
	}

	public string function render() {
		return "Hello " & variables.name;
	}

	/**
     * Example function that performs a boolean operation.
     * 
     * This function is a placeholder for demonstrating how to use the `example` function.
     * 
     * List:
     * - Foo
     * - Bar
     * 
     * Example usage:
     *     if (example("template.cfm", 42)) {
     *         // Do something if the condition is true
     *     }
     * @param template [required] The template string to be used.
     * @param line The line number as a numeric value.
     * @return Returns true.
     */
	static function staticGenerateID() {
		return "Hello World";
	}

}
