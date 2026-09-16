import coreWebVitals from "eslint-config-next/core-web-vitals";

// Mirrors frontend/dispatcher/eslint.config.mjs — eslint-config-next 16 exports a flat
// config array, so it is spread directly with no FlatCompat shim.
//
// The dispatcher's no-raw-hex rule is deliberately NOT carried over: this app does not
// consume the dispatcher's Tailwind token map, and importing the rule without the tokens
// it points at would fail every colour with advice that does not apply here.
const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "node_modules/**", "tsconfig.tsbuildinfo"]
  },
  ...coreWebVitals
];

export default eslintConfig;
