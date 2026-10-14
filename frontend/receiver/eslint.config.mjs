import coreWebVitals from "eslint-config-next/core-web-vitals";

// eslint-config-next 16 exports a flat config array, spread directly with no FlatCompat shim.
// The dispatcher's no-raw-hex rule is deliberately NOT carried over: this app doesn't
// consume the dispatcher's Tailwind token map.
const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "node_modules/**", "tsconfig.tsbuildinfo"]
  },
  ...coreWebVitals
];

export default eslintConfig;
