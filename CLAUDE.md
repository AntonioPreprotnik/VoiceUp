# VoiceUp

Windows desktop app that hosts an interactive Claude Code session in its own terminal and lets the user speak commands to it with a global hotkey from any app. Speech is transcribed locally and typed in only when Claude is ready. v1.2 adds an Android companion (desktop stream, voice and a few fixed controls from anywhere) through a Phoenix signaling server.

Users: Antonio and a few friends, each with their own Claude Pro/Max login. Windows only.

## Source of truth

- `docs/PLAN.md`: epics, stories, acceptance criteria, milestones, Definition of Done. **The plan wins.** If the code and the plan disagree, fix the plan first (same commit), then the code.
- `docs/TECH_SPEC.md`: how it is built: process model, hook config, state table, speech config, schemas, packaging, CI, tests.
- `docs/decisions/`: findings from spike stories. Later stories build on them; read the ones a story depends on.
- `.claude/skills/`: project skills. `/story <id>`, `/decision-note <id>` and `/release` are manual; the rest load automatically when you touch matching paths.

Values in TECH_SPEC marked "Verified 2026-10-26" were checked against package sources or a real run (Linux, Electron 45.0.0). Rows marked "confirm only" still need the Windows run in their spike. Do not re-research them; confirm them.

## How to work

- **One story per session**, in milestone order (M0 → M8). Never start the next story before the current one meets the Definition of Done.
- Start a story with `/story S<epic>.<n>`. Plan first; pause and show the plan when it touches more than ~5 files, or contradicts PLAN/TECH_SPEC.
- Stories marked **Spike** produce a decision note (`/decision-note <id>`), not production code. Throwaway spike code lives in `spikes/<id>/` or a throwaway branch.
- One story = one branch `story/<id>-<slug>` = one squashed commit `feat(<id>): …` (or `fix`/`test`/`docs`/`chore`). Do not push or open PRs unless asked. After Antonio's review, squash-merge to local `main`; from S0.3 on, the branch must be pushed and CI green first.
- Measure, don't guess: when a question is about packaging or native modules, the answer comes from the packaged Windows build.
- If something is unclear or the docs look wrong, stop and ask instead of inventing scope.

## Stack (exact versions, committed lockfile, no `^` for Electron, native addons or models)

Electron 45.x · electron-vite 5 / Vite 7 · TypeScript 6 strict · zod 4 · Vitest 5 · ESLint flat config · electron-builder 26 (NSIS, per-user) · electron-updater (public GitHub Releases) · node-pty (ConPTY) · @xterm/xterm + fit/webgl/unicode11 · sherpa-onnx-node 2.0.1 (Silero VAD; Moonshine base by default, Parakeet TDT 0.6B v2 int8 optional) in a `utilityProcess`.
v1.2: Elixir / Phoenix 1.8 Channels, coturn or eturnal (TURN REST API), Kotlin + Jetpack Compose, stream-webrtc-android.

When S0.1 runs, confirm each with `npm view <pkg>@<line> version`: the latest release in the named line, not the latest overall. Pin those and record them. TypeScript 7 is out until typescript-eslint supports it (PLAN.md dependency baseline).

## Commands (run inside `desktop/`; `dev` from S0.1, `test`, `lint`, `typecheck` from S0.2, packaging from S0.3)

- `npm run dev`: run the app
- `npm test`: Vitest
- `npm run lint`: ESLint
- `npm run typecheck`: `tsc -b --noEmit` (plain `tsc --noEmit` checks nothing, the root tsconfig only holds references)
- `npx electron-builder --win --dir --publish never` then `dist/win-unpacked/VoiceUp.exe --smoke-test=<file>`: packaged smoke test (result in the file and the exit code; `node-pty` from S1.1, speech from S4.2)

Dev machines need no compiler: `node-pty` loads from its bundled prebuilds (S0.6). VS Code is enough; Visual Studio Build Tools and Python are not required.

## Repository layout

Monorepo: `desktop/` and `docs/` in v1.0; `protocol/`, `server/`, `android/` arrive with E8. Each code folder gets its own short `CLAUDE.md`. Module import rules (TECH_SPEC §2) are enforced by ESLint.

## Engineering practices

### Code
- **TypeScript strict mode** everywhere (`"strict": true`, no `any` without a comment explaining why).
- **Pure core, thin shell.** Logic that can be tested without Electron (state machine, send gate, text filter, settings validation) lives in `src/core/` with no Electron or Node I/O imports. Electron glue lives in `src/main/`, UI in `src/renderer/`.
- **Validate every boundary** with a schema (zod): settings file, IPC payloads, hook HTTP bodies, model manifest. Reject and log, never trust.
- **No silent catches.** Every caught error is logged with context and either recovered or surfaced to the user.
- **One responsibility per module**; files over ~300 lines are a smell worth splitting.

### Electron security baseline (non-negotiable; details in the `electron-security` skill)
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on every window.
- Renderers get a minimal API via `contextBridge`; never expose raw `ipcRenderer`.
- Validate the sender of every IPC message in the main process.
- Strict Content-Security-Policy (`default-src 'self'`); load only bundled local files via `app://`, never remote content or `file://`. The only exception is the dev server, when `!app.isPackaged` (TECH_SPEC §7.1).
- Block navigation and new-window creation.
- Fuses via `electronFuses` in `electron-builder.yml` (RunAsNode, NODE_OPTIONS and inspect off; asar integrity and app-only-from-asar on).
- Local servers bind to `127.0.0.1` only, on a random port, and require a per-launch random token.

### Claude Code integration (details in the `claude-hooks` skill)
- Never write to `~/.claude/settings.json`, project `.claude/settings*.json` or `~/.claude.json`. Hooks reach Claude only through the per-launch `--settings` file.
- The hook receiver always answers 200 with an empty body; hooks must never change Claude's behaviour.
- Unknown or out-of-order events, and notification types outside the allowlist (TECH_SPEC §4.3) → state `unknown`, which blocks sending. Never guess `idle`, and never leave `unknown` on a timer.
- Never auto-accept workspace trust.

### Privacy
- Audio is processed in memory and discarded. Transcripts are not written to disk, except in logs when the user sets the log level to `debug`.
- Logs never contain transcripts at default log level, and never contain anything from `~/.claude/`.
- The app never reads, copies or transmits Claude credentials. Login happens only inside Claude Code's own flow.

### Remote access (v1.2, non-negotiable; full list in PLAN.md)
- Threat model (S9.1) before any streaming code. No free input by construction: no code path moves the mouse or types text from the phone. It can send only voice and the fixed actions in TECH_SPEC §9.1 (send now, re-arm, switch window, next or previous browser tab). Phone voice still drives Claude through the send gate, so a stolen paired phone is remote command execution; protection against it is parked in `docs/ideas.md` until the phone companion works.
- The server is untrusted: peers verify each other's signed DTLS fingerprints. Keys live in `safeStorage` / Android Keystore only.

### Testing
- **Unit tests (Vitest)** for everything in `src/core/`. The state machine and send gate need near-complete branch coverage.
- **Fakes over mocks:** the fake Claude (`test/fake-claude.mjs`, launched via `VOICEUP_CLAUDE_CMD`) replays recorded hook scenarios.
- A bug fix starts with a failing test. Tests never need a real Claude account, a microphone or the network.
- Hardware paths (mic, hotkey, installer) go on the manual checklist `docs/manual-tests.md`.

### Dependency hygiene
- Exact versions and a committed lockfile. Native modules are verified in a packaged build for every Electron major before the upgrade merges.
- CI gates: `npm audit --omit=dev` fails on high severity; licenses limited to MIT, Apache-2.0, BSD, ISC (exact-version exceptions in TECH_SPEC §7.3).
- Nothing loads from a CDN at runtime. Every asset is bundled or downloaded with a checksum.

## Definition of Done (every story; canonical list in PLAN.md)

- [ ] All acceptance criteria met and demonstrated (test name, command output or manual step per AC).
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass (from S0.2 on); CI is green on the pushed branch before merge (from S0.3 on).
- [ ] New core logic has unit tests; bugs fixed get a regression test first.
- [ ] No new Electron security warnings; baseline above still holds.
- [ ] User-visible errors have a clear message and a next step (error codes in TECH_SPEC §6.5).
- [ ] `docs/PLAN.md` / `docs/TECH_SPEC.md` updated if scope or design changed; a decision note added for any spike; the story's `[ ]` ticked in PLAN.md at merge.
