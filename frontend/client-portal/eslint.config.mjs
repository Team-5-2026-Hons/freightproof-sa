import coreWebVitals from "eslint-config-next/core-web-vitals";

// eslint-config-next 16 exports a flat config array, spread directly with no FlatCompat shim.
const eslintConfig = [
  {
    ignores: [".next/**", "out/**", "node_modules/**", "tsconfig.tsbuildinfo"]
  },
  ...coreWebVitals
];

export default eslintConfig;
