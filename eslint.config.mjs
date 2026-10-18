import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import ts from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import globals from "globals";
export default defineConfig([
  globalIgnores([
    "out/**",
    ".next/**",
    "public/pdfjs/**",
    "test-results/**",
    "playwright-report/**",
  ]),
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.worker },
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: { "react-hooks": hooks },
    rules: hooks.configs.recommended.rules,
  },
]);
