component {

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

	static function staticGenerateID() {
		return "Hello World";
	}

}
