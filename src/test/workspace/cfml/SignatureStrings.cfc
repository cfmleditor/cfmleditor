component {

	function pair(required string first, string second) {
		return arguments.first;
	}

	function useStrings() {
		this.pair("a(b", 42);
		this.pair("a,b", 42);
		this.pair('it''s (odd', 42);
		this.pair("plain", 42);
	}
}
