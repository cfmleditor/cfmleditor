<cfscript>
	function greet(required string person) {
		return arguments.person;
	}
</cfscript>
<cfset result = greet("template")>
<p>greet("plain text")</p>
