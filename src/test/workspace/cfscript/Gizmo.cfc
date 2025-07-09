component extends="cfscript.Base" {

	public cfscript.Gizmo function init(string name="") {
		variables.name = arguments.name;
		return this;
	}

	public cfscript.Gizmo fucntion compareTo(cfscript.Gizmo gizmo) {
		return compare(variables.name, gizmo.name);
	}

     /**
     * Constructor
     *
     * @wirebox The Injector
     * @wirebox.inject wirebox
     * @vars The vars I need
     * @vars.generic Array
     *
     * @return MyComponent
     * @throws SomethingException
     */
	public string function render() {
		return "Hello " & variables.name;
	}

	/**
     * Example function that performs a boolean operation
     * @param template [required]
The template string to be used.
     * @param line The line number as a numeric value.
     * @returns cfscript.Gizmo hello world string
     */
	static function staticGenerateID(template, line) {
		return "Hello World";
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
     * @param wirebox [required] The template string to be used.
     * @param {test} vars The line number as a numeric value.
     * @returns string hello world string2
     */
     function test( required wirebox, required vars ){
          variables.wirebox = arguments.wirebox;
          return this;
     }


}
