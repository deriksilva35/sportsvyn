import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // no-undef, ON. eslint-config-next leaves it off (it assumes TypeScript is
  // doing this job); this codebase is JavaScript, so nothing was.
  //
  // What that cost: a module-scope component in TrackerRoom.js called a helper
  // declared INSIDE the component. Valid syntax, clean build, green tests - and
  // a ReferenceError that took the tracker board down in production for every
  // reader with at least one pick logged. Lint is the only tool that could have
  // seen it, and it was the one tool not looking.
  //
  // Enabling it cost nothing: the repo-wide violation count was exactly one,
  // and it was that bug.
  {
    files: ['app/**/*.js', 'components/**/*.js', 'lib/**/*.js', 'scripts/**/*.mjs'],
    rules: { 'no-undef': 'error' },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // THE MOUNT TESTS' STUBS (lib/testing/stubDir.mjs). They are real .mjs files
    // written and unlinked while the suite runs, and eslint walking the tree at
    // that moment died on an ENOENT for one that had existed a millisecond
    // earlier. Ignoring the directory is half the fix; the other half is that
    // they are no longer written into app/ and components/ at all.
    "test-tmp/**",
  ]),
]);

export default eslintConfig;
