<cfcomponent>

	<cffunction name="init">
		<cfargument name="name" type="string" required="false">
		<cfset variables.id = generateID()>
		<cfreturn this>
	</cffunction>

	<cffunction name="generateID">
		<cfreturn "Hello World">
	</cffunction>

	<cffunction name="callMethod">
		<cfset var widget = new cfml.Widget("foo")>
		<cfset var widget.render()>
	</cffunction>

	<cffunction name="invokeMethod">
		<invoke component="cfml.Widget" method="staticGenerateID">
	</cffunction>

	<cffunction name="callMethodStatic">
		<cfreturn cfml.Widget::staticGenerateID()>
	</cffunction>


</cfcomponent>