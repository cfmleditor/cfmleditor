component extends="cfml.ChainParent" {

	public function overridden() {}

	public function useAll() {
		this.grandPublic();
		grandPublic();
		this.parentPublic();
		super.overridden();
		this.overridden();
		variables.grandPrivate();
		this.getGrandProp();
		this.getParentProp();
		var p = new cfml.ChainParent();
		p.grandPublic();
		p.parentPublic();
		var g = createObject("component", "cfml.ChainGrand");
		g.chainEnd();
		var viaTag = new cfml.ChainTagKid();
		viaTag.tagInherited();
		viaTag.tagOwn();
		var cyc = new cfml.ChainCycleA();
		cyc.cycleOwn();
		cyc.neverFound();
		var orphan = new cfml.ChainOrphan();
		orphan.orphanOwn();
		orphan.missingInherited();
	}
}
