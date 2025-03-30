<cfcomponent>

	<cfset variables.variablesVariable = "foo">

	<cffunction name="test_variable_definitions">
		<cfargument name="argumentVariable">

		<cfset local.localVariable = "foo">

		<cfset var varVariable = "foo">

		<cfset final finalVariable = "foo">
		<cfset application.applicationVariable = "foo">
		<cfset application.scopeDotVariable = "foo">
		<cfset application["scopeBracketVariable"] = "foo">
		<cfset application["scopeBracketsVariable"]['bar']["qux"] = "foo">

		<!--- Reference variables --->
		<cfset var ref = "">>
		<cfset ref = argumentVariable>
		<cfset ref = localVariable>
		<cfset ref = varVariable>
		<cfset ref = finalVariable>
		<cfset ref = applicationVariable>
		<cfset ref = scopeDotVariable>
		<cfset ref = scopeBracketVariable>
		<cfset ref = variables.variablesVariable>

		<cfset application["argumentVariable"] = "foo">
		<cfset application["localVariable"] = "foo">
		
	</cffunction>
	
	<cffunction name="test_">
		<cfargument name="variableName">
		<cfset local.variableName = "foo">
		<cfset var variableName = "foo">
		<cfreturn variableName>

	</cffunction>

</cfcomponent>
