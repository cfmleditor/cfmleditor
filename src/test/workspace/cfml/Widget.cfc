<cfcomponent extends="cfml.Base">

	<cffunction name="init" access="public" returntype="cfml.Widget" output="false">
		<cfargument name="name" type="string" required="false">
		<cfset variables.name = arguments.name>
		<cfreturn this>
	</cffunction>

	<cffunction name="render" access="public" returntype="string" output="true">
		<cfreturn "Hello #variables.name#">
	</cffunction>

	<cffunction name="clone" access="public" output="false">
		<cfparam type="cfml.WidgetFactory" name="request.WidgetFactory">
		<cfreturn request.WidgetFactory.create_with_new(variables.name)>
	</cffunction>

	<cffunction name="clone_with_static" access="public" output="false">
		<cfreturn WidgetFactory::create_with_new(variables.name)>
	</cffunction>

	<cffunction name="staticGenerateID" modifier="static">
		<cfreturn "Hello World">
	</cffunction>

    <!--- 
        
        test
        
        <!--- test --->

        <cffunction name="create_with_new" access="public" returntype="string" output="true">
            <cfreturn "Hello #variables.name#">
        </cffunction>

    --->

</cfcomponent>
