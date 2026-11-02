---
name: claude-hooks
description: How VoiceUp tracks Claude Code's state through hooks - generating the per-launch --settings hook config, the local hook HTTP receiver, the state reducer and scenario fixtures. Use when touching hooks, the state machine, the send gate or delivery.
paths:
  - "desktop/src/main/hooks/**"
  - "desktop/src/main/pty/**"
  - "desktop/src/core/state/**"
  - "desktop/src/core/gate/**"
  - "desktop/test/scenarios/**"
  - "desktop/test/fake-claude.mjs"
---

# Claude Code hooks and state

Spec: `docs/TECH_SPEC.md` §4. Ground truth for event order: `docs/decisions/S2.1-*.md` and `desktop/test/scenarios/*.json`.

## Hard rules
- Never write to `~/.claude/settings.json`, project `.claude/settings*.json` or `~/.claude.json`. Hooks reach Claude only through the per-launch file passed with `--settings`.
- Never read Claude settings except the keys that can block our hooks: `allowedHttpHookUrls`, `disableAllHooks`, managed `allowManagedHooksOnly` (TECH_SPEC §4.2).
- Hooks must never change Claude's behaviour: the receiver answers **200 with an empty body** after a valid token, always, even on bad JSON. No JSON decision output, ever.
- `SessionStart` supports only command/MCP hooks → `curl.exe` by absolute path in exec form (`command` + `args`) with `--noproxy "*"`, token via `-H @<headerfile>`, body via `--data-binary @-`. All other events use `type: "http"` with `headers` + `allowedEnvVars: ["VOICEUP_HOOK_TOKEN"]`.
- Hook handler timeout 5 s; no `onFailure: "block"`.
- Unknown or out-of-order events move state to `unknown` (fail safe). Never guess `idle`. `Stop` does not fire after a user interrupt, so `unknown` ends only through `idle_prompt`, a later turn or the manual re-arm, never on a timer.
- `SessionStart` with `source` `compact` or `fork` must not change state (auto-compaction fires mid-turn); `startup`, `resume`, `clear` → `idle`.
- In-turn events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`) keep `busy` as `busy`; they are not unknown. With `agent_id`, they also keep `idle` as `idle`.
- `SessionEnd` with reason `clear` or `resume` does not mean `exited`; the next `SessionStart` decides.
- Hooks don't report every local menu. Enter with no `UserPromptSubmit` or `SessionStart` within about 1 s raises `localUiSuspected` (TECH_SPEC §4.4).
- `Notification` body: `notification_type` (string), `message`, optional `title` (SDK `NotificationHookInput`). Match the values in TECH_SPEC §4.3; allowlisted harmless values leave state unchanged, and any other value moves it to `unknown`.
- Workspace trust: in an untrusted folder the trust dialog shows before the session starts and no hook fires until it is accepted, so state stays `starting` and the gate holds. Never auto-accept trust or write `hasTrustDialogAccepted`.
- Tests run the fake Claude via `VOICEUP_CLAUDE_CMD='["node","test/fake-claude.mjs"]'` (dev/test builds only).

## Changing the reducer
1. Record the real sequence first (run Claude with the debug receiver logging every body) and save it as a scenario JSON: `{ "name": "...", "events": [{ "event": "Stop", "body": {...} }] }`. Strip prompts, file contents, `cwd` and `transcript_path` from bodies: fixtures are public.
2. Add the transition to `src/core/state/reducer.ts` and to the table in TECH_SPEC §4.3.
3. Add a test that replays the scenario and asserts the state after each event.
4. Re-run the gate tests: every state must map to exactly one gate decision (§4.4).

## Debugging
- `/hooks` inside the embedded session lists the hooks Claude loaded.
- `claude --debug` shows hook execution; a non-2xx from us appears as a hook error notice in Claude's transcript, which must never happen.
- Logs: hook bodies only at `debug` (they may contain prompts and tool input).

Reference: https://code.claude.com/docs/en/hooks
