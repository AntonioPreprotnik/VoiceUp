# VoiceUp v1.2 threat model (S9.1)

Date: 2026-11-09 · Status: draft for Antonio's review. No E10 code is written until this is reviewed (PLAN.md, S9.1).

v1.2 lets a paired Android phone watch the PC's desktop and speak commands to Claude, through a VoiceUp server on a VPS (PLAN.md "Remote connection", TECH_SPEC §9). This page names what is worth protecting, who might attack it, and what stops each attack. Every mitigation points to the story that builds it. A mitigation marked **new** isn't in the plan yet: this spike adds it, and PLAN.md is updated in the same commit.

## What we protect

| Asset                  | Where it lives                                                      | Why it matters                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The Claude session** | PC: Claude Code in VoiceUp's terminal, in the user's project folder | Anyone who can send it a prompt can make it read, change or delete files and run commands, as far as Claude's permission mode allows. **This is the most valuable asset.** |
| **The screen**         | PC display, captured while a phone watches                          | Shows whatever is open: passwords being typed, messages, banking, other people's data                                                                                      |
| **Voice**              | Phone microphone, then PC memory                                    | Can carry private speech. Today audio never leaves the PC and is never stored (CLAUDE.md, Privacy)                                                                         |
| **Device keys**        | PC: Electron `safeStorage` (DPAPI). Phone: Android Keystore         | Whoever holds a paired key _is_ that device to the other side                                                                                                              |
| **Pairing records**    | Both apps, and the server's list of pairs                           | Decide who may connect to whom                                                                                                                                             |
| **Relay secret**       | Server only (TURN REST shared secret)                               | Lets someone mint relay credentials and spend the relay's bandwidth                                                                                                        |
| **The Claude login**   | `~/.claude/` on the PC                                              | Never read or sent by VoiceUp (CLAUDE.md). v1.2 must not change that                                                                                                       |

## Trust boundaries

- **PC ↔ phone**: trusted only after pairing, and only for the two message types the PC accepts (`voiceClip`, `cancel`, TECH_SPEC §9.1). Everything else closes the connection.
- **Either device ↔ server**: the server is **untrusted**. It can see who talks to whom and when, and it can drop or delay messages. It must never be able to read content, impersonate a device, or pair one on its own.
- **Network**: untrusted everywhere (café Wi-Fi, carrier NAT, the relay).
- **Other apps on each device**: untrusted. Another Windows user, or another Android app, must not reach the keys or the session.

## Attackers and what stops them

### A1. Someone who stole or picked up a paired phone

**Parked on 2026-11-09** until the phone companion works end to end. See `docs/ideas.md`. What the plan already has still applies: revocation (S9.6), "Ask every time" by default, auto-stop and the "Phone is watching" indicator (S9.5). The phone can never answer one of Claude's permission prompts, because the send gate blocks text while Claude asks.

### A2. A compromised or malicious VoiceUp server

| Attack                                                             | Mitigation                                                                                                                                                                                                                                     | Story      |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Man-in-the-middle the WebRTC stream with its own DTLS certificates | Each peer signs its DTLS fingerprint with its paired device key. The other side checks the signature, the SDP's `a=fingerprint`, and the certificate actually used (`getStats().remoteCertificateId`). Any mismatch aborts and warns on the PC | S9.4       |
| Pair its own device with the user's PC                             | Pairing needs the QR code shown on the PC (with a 128-bit nonce, valid 2 minutes) and the same 6-digit code confirmed on both screens. The server never sees the nonce, because it travels only in the QR code                                 | S9.3       |
| Replay an old session or signaling message                         | Signatures cover a session ID and a timestamp. Socket auth accepts each `(device_id, ts)` once, within ±60 s                                                                                                                                   | S8.2, S9.4 |
| Read voice, video or transcripts                                   | Never sent to it. Content flows end to end inside DTLS/SRTP, through the relay as opaque packets. The server stores no content, and its logs go after 7 days                                                                                   | S8.2, S8.4 |
| Learn who uses VoiceUp and when                                    | Accepted. It sees device IDs, IP addresses and connection times, like any rendezvous server. It holds no names or account data                                                                                                                 | S8.4       |
| Refuse service (drop messages)                                     | Accepted. It can always stop v1.2 working, but never desktop voice, which has no network dependency                                                                                                                                            | —          |

### A3. A network attacker (public Wi-Fi, carrier, the relay path)

| Attack                                          | Mitigation                                                                                                                 | Story      |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Read or change signaling                        | WSS with TLS (Caddy, Let's Encrypt). Signaling content is signed anyway, so the server and the network are untrusted alike | S8.2, S8.4 |
| Read or change the stream                       | DTLS/SRTP with fingerprints verified against paired keys (A2)                                                              | S9.4       |
| Steal relay credentials                         | Valid ≤ 10 minutes, bound to one device ID, issued only to authenticated devices                                           | S8.3       |
| Use the relay to reach the server's own network | coturn denies private and loopback ranges                                                                                  | S8.3       |

### A4. A malicious app or person on the PC's network, or on the PC

| Attack                                               | Mitigation                                                                                                                                                                                                               | Story               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| Connect to the PC directly                           | The PC opens no port. Both devices connect outward to the server (the AnyDesk model). The hook server stays on `127.0.0.1` with a per-launch token, as today                                                             | —                   |
| Send input events over the data channel              | Not possible by construction: the PC has no handler that moves the mouse or types. Only `voiceClip` and `cancel` are accepted, schema-checked and size-limited. Anything else closes the connection                      | S12.1, S12.2        |
| Read the PC's private key                            | Kept only in `safeStorage` (DPAPI, tied to the Windows user), never in plain files or logs. Another Windows user can't decrypt it. Malware running as the same user can, but it can already drive Claude without VoiceUp | S9.2                |
| Crash or exhaust the PC with huge or malformed clips | `bytes` ≤ 1,920,000 (60 s at 16 kHz), chunks ≤ 16 KB, SHA-256 checked, one recording or transcription at a time. A second request gets "busy"                                                                            | S12.1, S12.2, S12.3 |

### A5. Another app on the phone

| Attack                                          | Mitigation                                                                                                                                                      | Story       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| Read the phone's key                            | Android Keystore, non-exportable, hardware-backed where the phone has it, bound to user authentication (A1)                                                     | S9.2, S11.2 |
| Capture the video                               | Accepted with a guard: `FLAG_SECURE` on the viewing screen keeps the stream out of screenshots, screen recorders and the recent-apps thumbnail. **new**         | S11.3       |
| Send intents or deep links that start a session | **new:** the app exports no activity that starts a session. The `voiceup://pair` link only opens the pairing screen, which still needs the 6-digit confirmation | S11.2       |

### A6. Abuse of the server itself

| Attack                | Mitigation                                                                                                           | Story      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------- |
| Run up the relay bill | Rate limits per IP and per device, one active stream per PC, a per-session bandwidth cap and a monthly traffic alert | S8.5       |
| Brute-force pairing   | QR nonce valid 2 minutes. Rate limits on pairing attempts. A wrong 6-digit match ends the attempt                    | S8.5, S9.3 |

## Key algorithm: ECDSA P-256 on both sides

| Option                    | Android Keystore                                                                                                                                                                       | PC (Node `crypto` in Electron main) | WebRTC fit                                                | Result                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| **ECDSA P-256 (SHA-256)** | Supported in Keystore since Android 6, hardware-backed on most phones                                                                                                                  | Built in                            | WebRTC's own DTLS certificates use P-256 ECDSA by default | **Chosen**                                    |
| Ed25519                   | Added later. It needs KeyMint 2 and depends on the phone's secure hardware, per AOSP changes to `AndroidKeyStoreKeyPairGeneratorSpi`. Not something to count on across friends' phones | Built in                            | No difference                                             | Rejected: patchy Keystore support for no gain |

One algorithm everywhere keeps signing and verifying code identical on both sides, and the Kotlin and TypeScript test vectors can be shared through `protocol/`. Signatures go over the wire DER-encoded, as both platforms produce them.

## Minimum Android version: 11 (API 30)

- API 30 adds `setUserAuthenticationParameters` with `AUTH_BIOMETRIC_STRONG` and `AUTH_DEVICE_CREDENTIAL`. These name exactly which unlock methods may open the key, and for how long, which the parked stolen-phone idea needs (`docs/ideas.md`). Older versions have only the deprecated `setUserAuthenticationValidityDurationSeconds`, which is less precise. So this is the cleaner API, not a hard requirement.
- Android 11 and later run on roughly 90% of active devices (Android Studio numbers, October 2026: 11 is 10.5%, 12 is 9.6%, 13 is 11.8%, 14 is 15.3%, 15 is 14.7%, 16 is 25.4%, 17 about 1%). Android 10 and older no longer get security updates, which matters for an app that can drive Claude.
- Check friends' phones before S11.1. If one is on Android 10, lowering the minimum to API 29 is the fallback.

## Changes this model makes to the plan

Applied to PLAN.md in the same commit:

- **S11.1:** minimum Android 11 (API 30). The open decision "Minimum Android version" is closed.
- **S11.2:** the app exports nothing that starts a session; `voiceup://pair` only opens the pairing screen.
- **S11.3:** `FLAG_SECURE` on the viewing screen.

The stolen-phone changes (S9.2, S9.5, S11.7, S12.2) were parked on 2026-11-09 and moved to `docs/ideas.md`.

## Review checklist before E10

- [x] Antonio has read this page. The stolen-phone section is parked (2026-11-09).
- [ ] The decision note for S9.1 is written (`/decision-note S9.1`).
- [ ] The minimum Android version is checked against friends' phones.

## Sources

- [AOSP: Ed25519 signing keys in Android Keystore](https://gitlab.e.foundation/e/os/android_frameworks_base/-/commit/3875cf7e0c35f9d42a5d04b154f281ae547161a3) (mirror of the AOSP change)
- [Android `KeyGenParameterSpec`](https://d.android.com/reference/android/security/keystore/KeyGenParameterSpec) and [`KeyGenParameterSpec.Builder`](https://developer.android.com/reference/android/security/keystore/KeyGenParameterSpec.Builder)
- [API 30 changes to `KeyProperties`](https://developer.android.com/sdk/api_diff/30/changes/android.security.keystore.KeyProperties): `AUTH_BIOMETRIC_STRONG`, `AUTH_DEVICE_CREDENTIAL`
- [Android version distribution, October 2026](https://gadgets.beebom.com/news/google-android-17-adoption-figures-october-2026)
