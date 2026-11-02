import { ESLint } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import { importRules } from '../../eslint.import-rules.mjs'

// Loads only the import rules, without type information, so virtual file paths can be linted.
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    { files: ['**/*.ts'], languageOptions: { parser: tseslint.parser } },
    ...importRules
  ]
})

async function ruleIds(filePath: string, code: string): Promise<(string | null)[]> {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.map((message) => message.ruleId)
}

const namedImport = (specifier: string): string =>
  `import { x } from '${specifier}'\nexport { x }\n`

// One row per TECH_SPEC §2 table row: [file, allowed imports, forbidden imports].
const table: [string, string[], string[]][] = [
  [
    'src/core/a.ts',
    ['./b', '../core/b', '../shared/ipc'],
    ['electron', 'node:fs', 'fs', 'net', 'zod', '../main/x', '../renderer/x', '../worker/x']
  ],
  [
    'src/shared/a.ts',
    ['zod', 'zod/mini', './b'],
    ['electron', 'node:fs', 'lodash', '../core/x', '../main/x', '../renderer/x', '../worker/x']
  ],
  [
    'src/renderer/terminal/a.ts',
    ['./b', '../overlay/b', '../../shared/ipc', '@xterm/xterm', '@xterm/addon-fit'],
    ['electron', 'node:fs', 'fs', '../../main/x', '../../worker/x', '../../core/x']
  ],
  [
    'src/preload/a.ts',
    ['../shared/ipc'],
    ['node:fs', 'fs', '../main/x', '../worker/x', '../renderer/x', '../core/x']
  ],
  [
    'src/worker/a.ts',
    ['./b', '../core/x', '../shared/x', 'sherpa-onnx-node', 'node:fs'],
    ['electron', 'zod', '../main/x', '../renderer/x', '../preload/x']
  ],
  [
    'src/main/a.ts',
    ['electron', 'node:fs', 'zod', '../core/x', '../shared/x', '../worker/x', '../preload/x'],
    ['../renderer/x', '../renderer/terminal/main']
  ]
]

describe.each(table)('imports in %s', (file, allowed, forbidden) => {
  it.each(allowed)('allows %s', async (specifier) => {
    expect(await ruleIds(file, namedImport(specifier))).toEqual([])
  })

  it.each(forbidden)('forbids %s', async (specifier) => {
    expect(await ruleIds(file, namedImport(specifier))).toContain('no-restricted-imports')
  })
})

describe('import forms', () => {
  it('catches re-exports', async () => {
    const ids = await ruleIds('src/core/a.ts', "export { x } from 'node:fs'\n")
    expect(ids).toContain('no-restricted-imports')
  })

  it('catches type-only imports', async () => {
    const code = "import type { X } from 'electron'\nexport type { X }\n"
    expect(await ruleIds('src/core/a.ts', code)).toContain('no-restricted-imports')
  })

  it.each(['core/a', 'shared/a', 'preload/a', 'renderer/terminal/a'])(
    'forbids dynamic import() in src/%s.ts',
    async (file) => {
      const ids = await ruleIds(`src/${file}.ts`, "export const x = import('node:fs')\n")
      expect(ids).toContain('no-restricted-syntax')
    }
  )
})

describe('electron in preloads', () => {
  it.each(['contextBridge', 'ipcRenderer'])('allows %s', async (name) => {
    const code = `import { ${name} } from 'electron'\nexport { ${name} }\n`
    expect(await ruleIds('src/preload/a.ts', code)).toEqual([])
  })

  it.each([
    ['another API', "import { shell } from 'electron'\nexport { shell }\n"],
    ['the default export', "import electron from 'electron'\nexport { electron }\n"],
    ['a namespace import', "import * as electron from 'electron'\nexport { electron }\n"]
  ])('forbids %s', async (_label, code) => {
    expect(await ruleIds('src/preload/a.ts', code)).toContain('no-restricted-imports')
  })
})

describe('test files', () => {
  it.each(['core', 'shared', 'preload', 'renderer', 'worker'])(
    'lets %s tests import vitest',
    async (folder) => {
      expect(await ruleIds(`src/${folder}/a.test.ts`, namedImport('vitest'))).toEqual([])
    }
  )

  it('keeps vitest out of production code', async () => {
    const ids = await ruleIds('src/core/a.ts', namedImport('vitest'))
    expect(ids).toContain('no-restricted-imports')
  })

  it('keeps forbidding other packages in tests', async () => {
    const ids = await ruleIds('src/core/a.test.ts', namedImport('electron'))
    expect(ids).toContain('no-restricted-imports')
  })

  it('keeps forbidding blocked folders in tests', async () => {
    const ids = await ruleIds('src/core/a.test.ts', namedImport('../main/x'))
    expect(ids).toContain('no-restricted-imports')
  })
})
