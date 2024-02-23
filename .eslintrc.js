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
        "jsdoc/require-jsdoc": [
            "error",
            {
                "publicOnly": true,
                "require": {
                    "FunctionDeclaration": true,
                    "MethodDefinition": true
                }
            }
        ]
    }
};
