module.exports = {
    "env": {
        "es6": true,
        "node": true
    },
    "extends": [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:jsdoc/recommended-typescript",
    ],
    "ignorePatterns": ["/*", "!/src"],
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
        "project": "tsconfig.json",
        "sourceType": "module"
    },
    "plugins": [
        "@typescript-eslint",
        "jsdoc"
    ],
    "root": true,
    "rules": {
        "jsdoc/require-returns": ["error", {"enableFixer":true}],
        "jsdoc/require-param-description": ["off", {"contexts":["any"]}],
        "jsdoc/require-returns-description": ["off", {"contexts":["any"]}],
        "jsdoc/require-jsdoc": [
            "error",
            {
                "publicOnly": true,
                "require": {
                    "FunctionDeclaration": true,
                    "MethodDefinition": false,
                    "ClassDeclaration": false,
                    "ArrowFunctionExpression": false,
                    "FunctionExpression": false
                }
            }
        ]
    }
};
