---
name: story
description: Implement exactly one story from docs/PLAN.md end to end (branch, plan, code, tests, Definition of Done, commit). Run as /story S2.3.
argument-hint: [story-id e.g. S2.3]
arguments: [story]
disable-model-invocation: true
---

# Implement story $story

You are implementing **one** story from `docs/PLAN.md`. Nothing outside its acceptance criteria.

## 1. Load context
1. Read the `$story` section of `docs/PLAN.md` (title, user story, every `AC:` line).
2. Read the matching sections of `docs/TECH_SPEC.md` (search for the story id and for the components it names).
3. Read any decision notes in `docs/decisions/` that the story depends on (spikes listed in its ACs or in earlier stories).
4. If a dependency story is not merged yet, stop and say which one.

## 2. Branch
`git switch -c story/$story-<short-slug>` from an up-to-date `main`.

## 3. Plan first
Write a short plan before editing code:
- files to create or change, and why
- which acceptance criterion each change satisfies
- tests to add (unit in `src/core` first when logic is pure)
- anything in the plan or spec that looks wrong

If the story is marked **Spike**, the output is a decision note, not production code: use `/decision-note $story` and keep any code in a throwaway branch or `spikes/` folder.

Pause and show the plan if it touches more than ~5 files or contradicts PLAN.md / TECH_SPEC.md.

## 4. Implement
- Follow `CLAUDE.md` engineering practices (strict TS, pure core, zod at every boundary, no silent catches).
- Write the failing test first for core logic and every bug fix.
- Keep the diff to this story. Note unrelated problems for later instead of fixing them.

## 5. Definition of Done (all must hold)
This copies the canonical list in `docs/PLAN.md`.

- [ ] Every AC of $story met; show how each was checked (test name, command output or manual step).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` pass in `desktop/` from S0.2 on (or the equivalent in `server/` / `android/`); CI is green on the pushed branch before merge, from S0.3 on.
- [ ] New core logic has unit tests; bugs fixed get a regression test first.
- [ ] No new Electron security warnings; `electron-security` checklist still holds for touched windows/IPC.
- [ ] User-visible errors use a code from TECH_SPEC §6.5 with a message and next step.
- [ ] If scope or design changed: PLAN.md / TECH_SPEC.md updated in the same commit; a decision note added for any spike; the story's `[ ]` ticked in PLAN.md at merge.

## 6. Commit
One commit (squash fixups) with a Conventional Commit message scoped to the story:

```
feat($story): <what changed, imperative, ≤ 72 chars>

- AC1: <how it is met>
- AC2: <how it is met>
```

Use `fix(` / `test(` / `docs(` / `chore(` when more accurate. Do not push or open a PR unless asked. After the user's review, squash-merge to local `main`; from S0.3 on, the branch must be pushed and CI green first.

## 7. Report
Reply with: ACs and their evidence, test results, files changed, follow-ups noticed.
