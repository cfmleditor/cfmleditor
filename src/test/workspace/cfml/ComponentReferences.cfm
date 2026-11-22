<cfparam name="request.widget" type="cfml.Widget">
<cffunction name="tagFactory" returntype="cfml.Widget">
	<cfargument name="widget" type="cfml.Widget">
	<cfreturn arguments.widget>
</cffunction>

<cfscript>
cfml.Widget function scriptFactory(cfml.Widget widget) {
	return widget;
}
createdWidget = createObject("cfml.Widget");
cfml.Widget::staticGenerateID();
</cfscript>
