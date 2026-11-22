component accessors="true" extends="cfml.ComponentFeaturesBase" {
	property name="label" type="string";

	private function privateLabel() {}

	public function explicitMethod() {
		this.privateLabel();
		this.peerOnly();
		this.parentPrivate();
		this.parentPublic();
		this.getLabel();
		this.privateL;
		this.parentPriv;
	}

	public function getDisplayName() {}
}
