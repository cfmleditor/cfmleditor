component {
	function combine(required string first, required string second) {
		return arguments.first & arguments.second;
	}

	function example() {
		combine(
			"hello, world",
			this.combine("inner", "value")
		);
		combine(first="named", second="arguments");
		combine(first: "named with colon", second: "also named");
		// combine("comment", "ignored");
		var message = 'combine("string", "ignored")';
		missing("unresolved");
	}
}
