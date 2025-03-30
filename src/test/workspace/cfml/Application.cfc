<cfcomponent>

	<cffunction name="onRequestStart">
		<cfset application.applicationVariable = "foo">
		<cfset request.requestVariable = "foo">
		<cfset session.sessionVariable = "foo">
	</cffunction>

	<cffunction name="applicationUserFunction"></cffunction>

</cfcomponent>