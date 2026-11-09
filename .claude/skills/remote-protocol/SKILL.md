---
name: remote-protocol
description: VoiceUp v1.2 phone-to-PC protocol and its security rules - data-channel envelope, message schemas in protocol/, pairing confirmation code, signed DTLS fingerprints, TURN credentials. Use when adding or changing any message between the Android app, the PC or the signaling server.
paths:
  - "protocol/**"
  - "desktop/src/main/remote/**"
  - "android/protocol/**"
  - "android/rtc/**"
  - "android/pairing/**"
---

# Remote protocol (v1.2)

Spec: `docs/TECH_SPEC.md` §9. Threat model: `docs/threat-model.md` (must exist before any streaming code).

## Non-negotiables
- **No free input by construction.** Phone → PC accepts only `voiceClip.begin`, binary chunks, `voiceClip.end`, `cancel`, and S12.5's fixed actions: `sendNow`, `reArm`, `windows.list`, `window.focus`, `tab.next`, `tab.prev` (TECH_SPEC §9.1, added by Antonio on 2026-11-09). Never add a message that moves the mouse, types free text or arbitrary keys, opens files or runs commands. A new fixed action needs Antonio's say-so and a row in TECH_SPEC §9.1 first. A voice clip still becomes a Claude command after the send gate, so treat a stolen paired phone as remote command execution (`docs/threat-model.md`).
- Unknown `type`, bad envelope, wrong `v`, or size over limit → close the data channel and log the code.
- The server is untrusted: every session verifies the peer's signed DTLS fingerprint against the paired public key, then re-checks the remote certificate fingerprint from `getStats()`.
- Keys live in `safeStorage` (PC) / Android Keystore (phone). Never log keys, signatures, SDP or ICE candidates above `debug`.

## Adding a message type
1. Add a JSON Schema file in `protocol/schemas/<type>.json` and bump `protocol/VERSION` (minor for additive, major for breaking).
2. Add valid and invalid examples in `protocol/fixtures/<type>/`.
3. PC: zod schema in `desktop/src/shared/remote.ts`, tested against the fixtures.
4. Android: `@Serializable` class in `android/protocol`, tested against the same fixtures.
5. Update TECH_SPEC §9.1.

## Crypto recipes
- Confirmation code: `SHA-256(pcPub ‖ phonePub ‖ nonce)` → first 4 bytes big-endian → `% 1_000_000` → zero-padded 6 digits. Test vectors in `protocol/fixtures/sas/`.
- Session signature: `sign(deviceKey, SHA-256(fingerprint ‖ sessionId ‖ ts))`, `ts` ±60 s.
- TURN: `username = "${expiryUnix}:${deviceId}"`, `credential = base64(HMAC-SHA1(secret, username))`, TTL 600 s.

Use only platform crypto (Node `crypto` / WebCrypto, Android Keystore + `java.security`); no hand-rolled primitives.
