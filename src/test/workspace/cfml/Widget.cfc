<cfcomponent>

    <cffunction name="init" access="public" returntype="cfml.Widget" output="false">
        <cfargument name="name" type="string" required="false">
        <cfset variables.name = arguments.name>
        <cfreturn this>
    </cffunction>

    <cffunction name="render" access="public" returntype="string" output="true">
        <cfreturn "Hello #variables.name#">
    </cffunction>

</cfcomponent>
