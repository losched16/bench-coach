// Hook correctness, and nothing else.
//
//   npm run lint:hooks
//
// WHY A SEPARATE CONFIG RATHER THAN A REPO-WIDE ONE
//
// The practice builder did not render for four days because a useEffect sat
// below an early return, and `react-hooks/rules-of-hooks` would have caught it
// on the commit that introduced it. But this repo has no eslint config at all,
// and `next lint` on a codebase of this age reports hundreds of style findings
// the first time it runs. A gate that shouts about apostrophes and unused
// imports is a gate somebody turns off, and then the crash-level rule goes off
// with it.
//
// So this config is deliberately one rule. It is not a house style, it is not
// a formatting pass, and it is not `next lint`. If a style config arrives
// later it can live in .eslintrc.json and this file will keep working
// untouched, because the release gate names this file explicitly.
//
// exhaustive-deps is OFF on purpose. The repo already carries ~40 considered
// `eslint-disable-next-line react-hooks/exhaustive-deps` comments; it is a
// lint opinion about correctness-by-convention. rules-of-hooks is different in
// kind: breaking it is a runtime crash, every time, for every user.

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  // @next/next is registered but every rule in it stays off. Without it,
  // existing `eslint-disable-next-line @next/next/no-img-element` comments
  // scattered through the app raise "Definition for rule was not found" as
  // errors, and the gate fails for reasons that have nothing to do with hooks.
  plugins: ['react-hooks', '@next/next'],
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'off',
  },
  ignorePatterns: ['.next/', 'node_modules/', 'out/', 'public/'],
}
