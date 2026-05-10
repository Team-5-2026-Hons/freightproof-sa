import coreWebVitals from "eslint-config-next/core-web-vitals";

// eslint-config-next 16 exports a flat config array — spread directly, no FlatCompat needed.
const eslintConfig = [
  ...coreWebVitals,
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
