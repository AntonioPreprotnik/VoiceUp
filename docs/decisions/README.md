# Decision notes

Each Spike story writes one note here, `<story>-<slug>.md`, using the `/decision-note` template. Later stories read the notes they depend on.

## Pre-verification (2026-10-26)

These items were checked before any code existed, so the spikes start from known answers and only have to confirm them on Windows. The values are already copied into TECH_SPEC.md; this section records where they came from.

| Item | Answer | How it was checked | Still to do on Windows |
| --- | --- | --- | --- |
| `Notification` hook body fields (S2.1) | `notification_type` (string), `message` (string), `title?` | `NotificationHookInput` in `@anthropic-ai/claude-agent-sdk` `sdk.d.ts` | Record which `notification_type` values actually appear |
| Hooks before workspace trust (S2.1) | In an interactive session the trust dialog shows before the session starts; no hook fires until it is accepted | Claude Code docs, permissions page, section "What runs before you trust a folder" | Start once in a never-trusted folder; confirm nothing arrives before acceptance and `SessionStart` arrives after |
| `SessionStart` hook form (S2.1) | Spec uses `curl.exe` in exec form (`command` + `args`) | Hooks reference | Confirm the exec form runs on Windows; if not, record what does |
| sherpa-onnx config names (S4.1) | As in TECH_SPEC §5.2–5.3, including Moonshine's `preprocessor` / `encoder` / `uncachedDecoder` / `cachedDecoder`; `createAsync` and `decodeAsync` exist | `sherpa-onnx-node` 2.0.0 `types.js`, `vad.js`, `non-streaming-asr.js`; real run | Same config on the `sherpa-onnx-win-x64` prebuild in the packaged app (its DLLs sit beside the `.node`) |
| External-buffer rule (S4.1) | In Electron, `vad.front()`, `front(true)`, `readWave(path)` throw "External buffers are not allowed"; the `false` variants work; plain Node accepts all | Real run, Electron 45.0.0 `utilityProcess` (Linux x64) | Repeat in the packaged Windows build |
| Model archives (S4.1) | File names, SHA-256 and byte counts in TECH_SPEC §5.4; `silero_vad.onnx` 643,854 bytes | Downloaded from the `asr-models` release and hashed | None (hashes are platform-independent) |
| Model RAM and speed (S4.1) | Peak RSS ≈ 1.06 GB Parakeet, ≈ 0.53–0.61 GB Moonshine. Decode RTF at 1 thread: Moonshine ≈ 0.05–0.07, Parakeet ≈ 0.13–0.17. WER on 2 LibriSpeech clips 0–6 % for both | Real runs, 2 vCPU Linux container | Done on Antonio's PC: see `S4.1-speech-engine.md`. The weakest laptop moved to S7.5; the RAM threshold is gone |
| `.tar.bz2` extraction (S4.3) | Linux `tar -xjf` works: ≈ 25 s Moonshine, ≈ 55 s Parakeet on 2 vCPU | Real run | Done in S4.1: `C:\Windows\System32\tar.exe` deadlocks, because it needs an external `bzip2`. Git's `tar` took 73 s and 158 s. S4.3 picked `unbzip2-stream` with `tar-stream`: 40 s for Moonshine |
| `electronFuses` in electron-builder (S0.3) | Supported natively since electron-builder 26 (`FuseOptionsV1`); applied after `afterPack`, before signing | `app-builder-lib` 26.18.0 `configuration.d.ts`, `platformPackager.js`; a cross-built Windows `.exe` read back with `npx @electron/fuses read` showed all five fuses set | Add the read-back check to CI (S0.3 AC) |
| `Stop` after an interrupt (S2.1), added 2026-11-02 | Does not run after a user interrupt; `idle_prompt` comes about 60 s after Claude finishes, only if the user hasn't typed and no background agent runs | Hooks reference | Record it once in the Esc scenario |
| `node-pty` install (S0.6), added 2026-11-02 | 1.1.0's install script is `node scripts/prebuild.js \|\| node-gyp rebuild`, it depends on `node-addon-api`, and `binding.gyp` sets `SpectreMitigation`. Prebuild contents were not inspected | npm metadata and package files | Done: see `S0.6-node-pty-packaging.md`. No rebuild or Build Tools needed |

Sources: [Claude Code permissions](https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder) · [Claude Code hooks](https://code.claude.com/docs/en/hooks) · [claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) · [sherpa-onnx-node](https://www.npmjs.com/package/sherpa-onnx-node) · [asr-models release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models) · [app-builder-lib](https://www.npmjs.com/package/app-builder-lib) · [@electron/fuses](https://github.com/electron/fuses)
