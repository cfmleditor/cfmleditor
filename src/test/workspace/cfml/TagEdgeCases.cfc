<cfcomponent hint="a > b in the component hint" extends="cfml.ChainGrand">
	<!--- <cffunction name="ghost" access="public"></cffunction> --->

	<cffunction name="gtHint" access="public" returntype="string" hint="a > b means greater">
		<cfargument name="x" type="numeric" default="1" hint="x > y is true">
		<cfreturn "">
	</cffunction>

	<cffunction name="afterGt" access="public" returntype="numeric" hint="comes after a > in an attribute">
		<cfargument name="y" type="string" default="#now()#">
		<cfargument name="z" type="string" default="a)b">
		<cfreturn 1>
	</cffunction>

	<cffunction name="stringHasTag" access="public">
		<cfset var s = "<cffunction name='fake'>">
		<cfreturn s>
	</cffunction>

	<cffunction name="afterString" access="public">
	</cffunction>

	<cffunction name="useThem" access="public">
		<cfset this.gtHint(1)>
		<cfset this.afterGt("a")>
		<cfset this.ghost()>
		<cfset this.fake()>
		<cfset this.afterString()>
		<cfset this.grandPublic()>
	</cffunction>
</cfcomponent>
