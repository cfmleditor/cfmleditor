import typescriptEslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default [{
    ignores: [
        "*",
        "!src",
        "node_modules/*",
        "./node_modules/**/*",
        "**/node_modules/**/*",
    ],
}, ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended-type-checked",
    "plugin:jsdoc/recommended-typescript",
), {
    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        globals: {
            ...globals.node,
        },

        parser: tsParser,
        ecmaVersion: 5,
        sourceType: "module",

        parserOptions: {
            project: "tsconfig.json",
        },
    },

    rules: {
        "jsdoc/require-returns": ["error", {
            enableFixer: true,
        }],

        "jsdoc/require-param-description": ["off", {
            contexts: ["any"],
        }],

        "jsdoc/require-returns-description": ["off", {
            contexts: ["any"],
        }],

        "jsdoc/require-jsdoc": ["error", {
            publicOnly: true,

            require: {
                FunctionDeclaration: true,
                MethodDefinition: false,
                ClassDeclaration: false,
                ArrowFunctionExpression: false,
                FunctionExpression: false,
            },
        }],
        //#region disabled errors
        //TODO: fix these 1 at a time
        "@typescript-eslint/no-unsafe-argument": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-enum-comparison": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/prefer-promise-reject-errors": "off",
        "@typescript-eslint/require-await": "off",
        "@typescript-eslint/restrict-plus-operands": "off",
        "@typescript-eslint/restrict-template-expressions": "off",
        "@typescript-eslint/unbound-method": "off",
        //#endregion
    },
}];