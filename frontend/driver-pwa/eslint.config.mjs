import { fileURLToPath } from "node:url";
import path from "node:path";
import { FlatCompat } from "@eslint/eslintrc";

// eslint-config-next 16 shipped a native flat-config array (no FlatCompat needed), but
// that version doesn't support next@15 (see package.json — pinned back to ^15.5.20 to
// match this project's next@^15.0.0). eslint-config-next 15 still ships its rules in the
// legacy .eslintrc `extends` format, so FlatCompat is required to bridge it into ESLint
// 9's flat config — this is the same bridge Next.js's own `create-next-app` scaffold uses
// for a next@15 + ESLint 9 project.
const compat = new FlatCompat({
  baseDirectory: path.dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    // android/**, ios/** (native Capacitor build output) and out/** (static export
    // output) are generated, not authored — linting them is noise, not signal.
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
