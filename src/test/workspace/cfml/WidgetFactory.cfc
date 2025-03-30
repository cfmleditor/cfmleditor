<cfimport path="cfml.Widget">

<cfcomponent implements="cfml.IFactory">

	<cfproperty type="cfml.Widget" name="widgetProperty">

	<cfset variables.variablesWidget = new cfml.Widget()>

	<cffunction name="create_with_new" returntype="cfml.Widget" output="false" modifier="static">
		<cfargument name="name" type="string" required="false">
		<cfset var widget = new cfml.Widget()>
		<cfset widget.init(arguments.name)>
		<cfreturn widget>
	</cffunction>

	<cffunction name="create_with_createobject_component" returntype="cfml.Widget" output="false" modifier="static">
		<cfargument name="name" type="string" required="false">
		<cfset var widget = createObject("component", "cfml.Widget").init(arguments.name)>
		<cfreturn widget>
	</cffunction>

	<cffunction name="create_with_createobject" returntype="cfml.Widget" output="false" modifier="static">
		<cfargument name="name" type="string" required="false">
		<cfset var widget = createObject("cfml.Widget").init(arguments.name)>
		<cfreturn widget>
	</cffunction>

	<cffunction name="create_from" returntype="cfml.Widget" output="false" modifier="static">
		<cfargument type="cfml.Widget" name="source" required="true">
		<cfset var widget = new cfml.Widget(arguments.source.name)>
		<cfreturn widget>
	</cffunction>

	<cffunction name="create_with_wrong_case" returntype="cFML.wIDGET" output="false" modifier="static">
		<cfargument name="name" type="string" required="false">
		<cfset var widget = new cFML.wIDGET()>
		<cfset widget.init(arguments.name)>
		<cfreturn widget>
	</cffunction>

	<cffunction name="invoke_call" returntype="cfml.Widget" output="false" modifier="static">
		<cfinvoke component="cfml.Widget" method="staticGenerateID">
	</cffunction>

	<cffunction name="canCreate" returntype="boolean">
		<cfargument name="widget" type="any" required="true">
		<cfreturn isInstanceOf(widget, "cfml.Widget")>
	</cffunction>

</cfcomponent>