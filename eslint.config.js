import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist", "raw", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Ban raw color values in className (hex, raw palette shades, white/black
      // opacity, arbitrary color brackets) while allowing structural arbitrary
      // values like [&_svg]:size-4 or ring-[3px] that shadcn components rely on.
      "no-restricted-syntax": [
        "error",
        {
          "selector": "JSXAttribute[name.name='className'] Literal[value=/#[0-9A-Fa-f]{3,8}\\b|\\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|shadow|caret|accent|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d|\\b(?:bg|text|border|ring|fill|stroke)-(?:white|black)(?:\\/|\\b)|-\\[(?:#|rgb|hsl|oklch)/]",
          "message": "Use semantic Tailwind tokens (bg-surface, text-muted-foreground, bg-good) instead of raw colors. Structural arbitrary values like [&_svg] are fine."
        }
      ]
    },
  },
];
