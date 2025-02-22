<cfcomponent>

    <cffunction name="create" access="public" returntype="cfml.Widget" output="false" modifier="static">
        <cfargument name="name" type="string" required="false">
        <cfset var widget = new cfml.Widget()>
        <cfset widget.init(arguments.name)>
        <cfreturn widget>
    </cffunction>


</cfcomponent>