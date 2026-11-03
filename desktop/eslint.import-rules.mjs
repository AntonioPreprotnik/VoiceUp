// Module import rules from TECH_SPEC §2, enforced per folder. The spec's "May import" column is
// treated as an allowlist. test/lint/import-rules.test.ts covers every row.

const ALL_FOLDERS = ['core', 'shared', 'main', 'preload', 'renderer', 'worker']

// folders: other source folders this folder may import.
// packages: regex fragments for allowed packages; null allows every package.
// forbiddenPackages: regex fragments for packages banned from a folder that otherwise allows all.
// dynamicImport: whether import() is allowed. no-restricted-imports cannot see import(), so
// folders with a tight allowlist ban it outright.
const RULES = {
  core: { folders: ['shared'], packages: [], dynamicImport: false },
  shared: { folders: [], packages: ['zod(?:/|$)'], dynamicImport: false },
  renderer: { folders: ['shared'], packages: ['@xterm/'], dynamicImport: false },
  preload: { folders: ['shared'], packages: ['electron$'], dynamicImport: false },
  worker: {
    folders: ['core', 'shared'],
    packages: ['sherpa-onnx-node(?:/|$)', 'node:'],
    dynamicImport: true
  },
  main: {
    folders: ['core', 'shared', 'preload', 'worker'],
    packages: null,
    // Only the speech worker loads the addon, so a native crash can't take the app down.
    forbiddenPackages: ['sherpa-onnx'],
    dynamicImport: true
  }
}

// Preloads get two electron APIs only. A package pattern cannot limit imported names.
const PRELOAD_ELECTRON = {
  name: 'electron',
  allowImportNames: ['contextBridge', 'ipcRenderer'],
  message: 'TECH_SPEC §2: preloads may use only contextBridge and ipcRenderer from electron.'
}

function configFor(folder, { folders, packages, forbiddenPackages, dynamicImport }, { tests }) {
  const blocked = ALL_FOLDERS.filter((name) => name !== folder && !folders.includes(name))
  const patterns = [
    {
      // A relative import that reaches into a blocked source folder.
      regex: `^\\.{1,2}/(?:.*/)?(?:${blocked.join('|')})(?:/|$)`,
      message: `TECH_SPEC §2: ${folder}/ must not import this folder.`
    }
  ]
  if (packages !== null) {
    const allowed = tests ? [...packages, 'vitest$'] : packages
    patterns.push({
      // Anything that is neither a relative path nor an allowed package.
      regex: `^(?!${['\\.{1,2}(?:/|$)', ...allowed].join('|')})`,
      message: `TECH_SPEC §2: ${folder}/ must not import this package.`
    })
  }

  if (forbiddenPackages !== undefined) {
    patterns.push({
      regex: `^(?:${forbiddenPackages.join('|')})`,
      message: `TECH_SPEC §3: ${folder}/ must not load this package.`
    })
  }

  const rules = {
    'no-restricted-imports': [
      'error',
      { paths: folder === 'preload' ? [PRELOAD_ELECTRON] : [], patterns }
    ]
  }
  if (!dynamicImport) {
    rules['no-restricted-syntax'] = [
      'error',
      {
        selector: 'ImportExpression',
        message: `TECH_SPEC §2: import() is not allowed in ${folder}/, it bypasses the import rules.`
      }
    ]
  }

  return {
    name: `voiceup/imports/${folder}${tests ? '-tests' : ''}`,
    files: [tests ? `src/${folder}/**/*.test.ts` : `src/${folder}/**/*.ts`],
    rules
  }
}

const entries = Object.entries(RULES)

export const importRules = [
  ...entries.map(([folder, rule]) => configFor(folder, rule, { tests: false })),
  // Listed second so that, for test files, these replace the production rules above.
  ...entries.map(([folder, rule]) => configFor(folder, rule, { tests: true }))
]
