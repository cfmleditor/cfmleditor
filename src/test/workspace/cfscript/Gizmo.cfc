component extends="cfscript.Base" {

    /**
     * Foo
     */
    function test1() {
        /* Hover: "Foo" */
    }
    /**
     * Bar
     */
    function test2() {
        /* Hover: "Bar" */
        // There are no docblocks after this slash comment
    }
    /**
     * Qux
     */
    function test3() {
        /* Hover: No function description */
    }

}
