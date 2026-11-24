<cfscript>
	real = 1;
	text = "<cfset inString = 1>";
	other = "x = 1; inString2 = 2;";
	multi = "first line
		inMultiline = 3;
		last line";
	afterStrings = 4;
</cfscript>
<cfset realTag = 5>
<cfoutput>
	#real# #inString# #inString2# #inMultiline# #afterStrings# #realTag#
</cfoutput>
