---
name: decision-note
description: Write the decision note that a Spike story produces, in docs/decisions/. Run as /decision-note S4.1.
argument-hint: [story-id]
arguments: [story]
disable-model-invocation: true
---

# Decision note for $story

A spike's deliverable is a written finding that later stories build on. Write it to
`docs/decisions/$story-<short-slug>.md` using exactly this template:

```markdown
# $story — <question in one line>

Date: <YYYY-MM-DD> · Status: decided | needs-follow-up

## Decision
<One or two sentences: what we will do. Lead with it.>

## Evidence
<Numbers, logs, recorded event sequences. Tables over prose. Include the exact
commands or scripts used so the result can be reproduced.>

| Option | Result | Notes |
| --- | --- | --- |

## Environment
Windows build, CPU, RAM, Electron version, package versions (exact).

## Consequences
- Which stories change and how (story ids).
- Values to copy into TECH_SPEC.md (and do copy them in the same commit).

## Rejected options
<Each with the one reason it lost.>
```

Rules:
- Measure on the packaged build when the question is about packaging or native modules.
- Report medians of at least 5 runs for latency; state the clip length and model.
- Recorded hook sequences (S2.1) also go to `desktop/test/scenarios/*.json` as fixtures.
- Update every TECH_SPEC.md value and §11 question that this spike answers.
- Commit as `docs($story): decision note`.
