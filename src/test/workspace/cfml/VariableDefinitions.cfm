<!--- Variable assignments --->
<cfset variables.variablesVariable = "foo">
<cfset url.urlVariable = "foo">
<cfparam name="url.cfparamUrlVariable">
<cfloop index="variables.loopIndex" from="1" to="10"></cfloop>

<!--- Scoped references --->
<cfset ref = variables.variablesVariable>
<cfset ref = url.urlVariable>
<cfset ref = url.cfparamUrlVariable>
<cfset ref = variables.loopIndex>

<!--- Unscoped references --->
<cfset ref = variablesVariable>
<cfset ref = urlVariable>
<cfset ref = cfparamUrlVariable>
<cfset ref = loopIndex>
