---
name: speech-pipeline
description: VoiceUp's speech pipeline - mic capture in the recorder window, 16 kHz frames over a MessagePort, Silero VAD and sherpa-onnx recognition in the speech worker, model manifest and downloads, text cleaning and benchmarks. Use when changing recording, endpointing, transcription, models or latency.
paths:
  - "desktop/src/worker/**"
  - "desktop/src/renderer/recorder/**"
  - "desktop/src/main/models/**"
  - "desktop/src/core/text/**"
  - "desktop/resources/models.json"
  - "desktop/test/audio/**"
---

# Speech pipeline

Spec: `docs/TECH_SPEC.md` §5 and §6.2. Engine decision and measured numbers: `docs/decisions/S4.1-*.md`.

## Invariants
- Audio format everywhere: mono `Float32Array`, 16 kHz, frames of 512 samples (32 ms). Recorder → worker only, via the `MessageChannelMain` port; audio never passes through main and is never written to disk.
- One hotkey press = one `recordingId` = at most one transcript. Drop any worker message whose `recordingId` is not current.
- The mic stream exists only while recording. Stop every track on end/cancel.
- The worker owns sherpa-onnx; main never imports it. Use `OfflineRecognizer.createAsync` and `decodeAsync` so the worker can still handle `cancel`; main still enforces a timeout of max(10 s, half the clip length) and restarts the worker on expiry.
- Electron external-buffer rule: `vad.front(false)`, `readWave(path, false)` (see `native-modules`).
- `sherpa-onnx-node` is pinned to an exact version (2.0.0 verified). Config field names are in its `types.js`; re-check them on every bump.

## Models (verified 2026-10-26, from the `asr-models` release)
| id | `type` / config block | Archive bytes | Files (inside `dir`) |
| --- | --- | --- | --- |
| `parakeet-tdt-0.6b-v2-int8` | `transducer` + `modelType: 'nemo_transducer'` | 482,468,385 | `encoder.int8.onnx`, `decoder.int8.onnx`, `joiner.int8.onnx`, `tokens.txt` |
| `moonshine-base-en` | `moonshine` (`preprocessor`, `encoder`, `uncachedDecoder`, `cachedDecoder`) | 250,807,309 | `preprocess.onnx`, `encode.int8.onnx`, `uncached_decode.int8.onnx`, `cached_decode.int8.onnx`, `tokens.txt` |
SHA-256 values live in `resources/models.json` and TECH_SPEC §5.4. `silero_vad.onnx` is 643,854 bytes.

## Tuning knobs (settings → worker `init`)
| Setting | VAD/recognizer field | Default |
| --- | --- | --- |
| `endSilenceSec` | `sileroVad.minSilenceDuration` | 1.2 |
| `minSpeechSec` | `sileroVad.minSpeechDuration` | 0.25 |
| `maxRecordingSec` | `sileroVad.maxSpeechDuration` | 60 |
| — | `sileroVad.threshold` | 0.5 |
| — | recognizer `numThreads` | min(4, cores − 1) |

Changing a default requires a benchmark run (below) and a note in the commit.

## Adding a model
1. Add an entry to `resources/models.json` with `id`, `type`, pinned `url`, `sha256`, `bytes` and the file map.
2. Compute `sha256` from the downloaded archive yourself; never copy it from a web page.
3. Add the `id` to the `modelId` enum in `src/shared/settings.ts` (keep `auto` first: it resolves to Moonshine, per the S4.1 decision note).
4. Map `type` → recognizer config in `src/worker/recognizer.ts`.
5. Run the benchmark on both reference machines.

## Benchmark
`npm run bench:speech -- --model <id> --dir <folder>` decodes the 20 WAVs in that folder (each with a `.txt` reference; recordings stay out of this public repo unless the speaker agrees) and prints WER, median and p95 decode ms. Budget: preview ≤ 1.5 s after end of speech on the low-end laptop.

## Text cleaning
`src/core/text/clean.ts` is pure: trim, collapse whitespace, strip control chars, remove bracketed tags, collapse 4+ repeated tokens, `null` below `minWords`. Every new artifact seen in practice gets a fixture in `clean.test.ts` first.
