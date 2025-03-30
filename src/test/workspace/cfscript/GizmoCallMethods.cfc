component {

	function init(string name="") {
		variables.id = generateID();
		return this;
	}

	function generateID() {
		return "Hello World";
	}

	function callMethod() {
		var gizmo = new cfscript.Gizmo("foo");
		gizmo.render();
	}

	function invokeMethod() {
		return invoke("cfscript.Gizmo", "staticGenerateID");
	}

	function callMethodStatic() {
		return cfscript.Gizmo::staticGenerateID();
	}

}
