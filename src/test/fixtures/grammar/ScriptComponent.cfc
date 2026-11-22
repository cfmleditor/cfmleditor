/**
 * @hint A component with an import and a modifier.
 */
import "app.Model";
import app.models.*; // Import a package.
final component extends="app.Base" {
	function hello() {
		return new Model();
	}
}
