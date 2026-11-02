import { describe, expect, it } from 'vitest'
import {
  childEnv,
  chooseClaudeCommand,
  firstWhereResult,
  parseClaudeOverride
} from './claudeCommand'

const CMD_EXE = 'C:\\Windows\\System32\\cmd.exe'
const none = {
  whereExe: undefined,
  localBinExe: undefined,
  whereCmd: undefined,
  cmdExe: CMD_EXE
}

describe('chooseClaudeCommand', () => {
  it('prefers the exe on PATH over everything else', () => {
    const command = chooseClaudeCommand({
      whereExe: 'C:\\path\\claude.exe',
      localBinExe: 'C:\\local\\claude.exe',
      whereCmd: 'C:\\npm\\claude.cmd',
      cmdExe: CMD_EXE
    })
    expect(command).toEqual({ file: 'C:\\path\\claude.exe', args: [] })
  })

  it('uses the local bin exe next', () => {
    const command = chooseClaudeCommand({
      ...none,
      localBinExe: 'C:\\local\\claude.exe',
      whereCmd: 'C:\\npm\\claude.cmd'
    })
    expect(command).toEqual({ file: 'C:\\local\\claude.exe', args: [] })
  })

  it('runs a .cmd through the full path to cmd.exe', () => {
    // node-pty fails with an empty "File not found" on a relative name that exists in the current
    // folder, and an app launched from Explorer starts in System32.
    const command = chooseClaudeCommand({ ...none, whereCmd: 'C:\\npm\\claude.cmd' })
    expect(command).toEqual({ file: CMD_EXE, args: ['/d', '/s', '/c', 'C:\\npm\\claude.cmd'] })
  })

  it('returns null when Claude is not installed', () => {
    expect(chooseClaudeCommand(none)).toBeNull()
  })
})

describe('firstWhereResult', () => {
  it('takes the first line of several', () => {
    expect(firstWhereResult('C:\\a\\claude.exe\r\nC:\\b\\claude.exe\r\n')).toBe('C:\\a\\claude.exe')
  })

  it.each(['', '\r\n', '   \r\n'])('finds nothing in %j', (stdout) => {
    expect(firstWhereResult(stdout)).toBeUndefined()
  })
})

describe('parseClaudeOverride', () => {
  it('parses a command with arguments', () => {
    expect(parseClaudeOverride('["node", "test/fake-claude.mjs"]')).toEqual({
      file: 'node',
      args: ['test/fake-claude.mjs']
    })
  })

  it('parses a command alone', () => {
    expect(parseClaudeOverride('["fake"]')).toEqual({ file: 'fake', args: [] })
  })

  it.each(['not json', '"node"', '{}', '[]', '[""]', '[1]', '["node", 2]', 'null'])(
    'rejects %s',
    (raw) => {
      expect(parseClaudeOverride(raw)).toBeNull()
    }
  )
})

describe('childEnv', () => {
  it('removes the variables that mark a nested session', () => {
    const env = childEnv({ CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', PATH: 'x' })
    expect(env).toEqual({ PATH: 'x' })
  })

  it('removes them whatever their case, as Windows variable names ignore case', () => {
    expect(childEnv({ ClaudeCode: '1', PATH: 'x' })).toEqual({ PATH: 'x' })
  })

  it('passes everything else unchanged, including an API key', () => {
    const env = { ANTHROPIC_API_KEY: 'k', Path: 'x', CLAUDE_CONFIG_DIR: 'y' }
    expect(childEnv(env)).toEqual(env)
  })

  it('drops undefined values', () => {
    expect(childEnv({ A: undefined, B: 'b' })).toEqual({ B: 'b' })
  })
})
