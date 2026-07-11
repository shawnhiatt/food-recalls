import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "convex/_generated/**",
      "tests/**",
      ".next/**",
      "public/sw.js",
      "public/swe-worker-*.js",
      "next-env.d.ts", // Next-generated; always contains a triple-slash reference
    ],
  },
  {
    rules: {
      // Destructure-to-omit ("const { a, ...rest } = x" to drop `a`) is an
      // established pattern in convex/ (e.g. recalls.ts's toNormalized) —
      // the discarded bindings aren't a real "unused var" bug.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
];

export default eslintConfig;
