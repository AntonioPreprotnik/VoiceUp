---
name: release
description: Cut a VoiceUp desktop release - version bump, changelog, packaged build, smoke test, checksums, manual checklist. Run as /release 1.0.0.
argument-hint: [semver e.g. 1.0.0]
arguments: [version]
disable-model-invocation: true
---

# Release v$version

Do these in order and stop on the first failure.

1. **Clean tree.** `git status` is clean, on `main`, up to date with origin.
2. **Gates.** In `desktop/`: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm audit --omit=dev --audit-level=high`.
3. **Version.** Set `"version": "$version"` in `desktop/package.json`; no other version strings are hand-edited.
4. **Changelog.** Prepend a `## $version — <date>` section to `CHANGELOG.md` generated from Conventional Commits since the last tag, grouped Features / Fixes / Other, each line with its story id.
5. **Package locally.** `npx electron-builder --win --publish never`.
6. **Smoke test.** Run the built app with `--smoke-test=<file>`; the file must contain `{"pty":"ok","speech":"ok"}` and the exit code must be 0.
7. **Manual checklist.** Print the `docs/manual-tests.md` checklist and ask the user to confirm it was run on a clean Windows VM. Do not continue without that confirmation.
8. **Tag.** Commit `chore(release): v$version`, then `git tag -a v$version -m "v$version"`.
9. **Stop.** Do not push the tag or publish. Tell the user the exact commands: `git push origin main --follow-tags` (CI then builds the draft GitHub Release and writes `SHA256SUMS.txt`; checksums come from CI because the shipped files are the CI build).

Never sign, upload or publish anything yourself.
