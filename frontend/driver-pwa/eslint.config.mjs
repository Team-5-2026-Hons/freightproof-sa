import { fileURLToPath } from "node:url";
import path from "node:path";
import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 16 shipped a native flat-config array (no FlatCompat needed), but
const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "node_modules/**", "android/**", "ios/**", "public/sw.js", "tsconfig.tsbuildinfo"]
  },
  ...compat.extends("next/core-web-vitals"),
  {
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
          message: "No raw hex in component code. Use the Tailwind token map (see DESIGN_SYSTEM.md §2.3)."
        }
      ]
    }
  },
  {
    files: ["lib/tokens.ts", "tailwind.config.ts"],
    rules: { "no-restricted-syntax": "off" }
  }
];

export default eslintConfig;
