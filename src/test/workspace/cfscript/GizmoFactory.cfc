component {

	public static cfscript.Gizmo function create_with_new(string name="") {
		var gizmo = new cfscript.Gizmo();
		gizmo.init(arguments.name);
		return gizmo;
	}

	public static cfscript.Gizmo function create_with_createobject_component(string name="") {
		var widget = createObject("component", "cfscript.Gizmo").init(arguments.name);
		return widget;
	}

	public static cfscript.Gizmo function create_with_createobject(string name="") {
		var widget = createObject("cfscript.Gizmo").init(arguments.name);
		return widget;
	}

	public static cfscript.Gizmo function create_from(cfscript.Gizmo source) {
		var widget = new cfscript.Gizmo(source.name);
		return widget;
	}

	public static string function invoke_call() {
		return invoke("cfscript.Gizmo", "staticGenerateID");
	}

}
