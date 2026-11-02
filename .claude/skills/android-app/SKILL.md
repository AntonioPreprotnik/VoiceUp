---
name: android-app
description: Conventions for the VoiceUp v1.2 Android companion app (Kotlin, Jetpack Compose, WebRTC via stream-webrtc-android, Keystore keys, mic capture, distribution as signed APK). Use when working anywhere in android/.
paths:
  - "android/**"
---

# Android companion (v1.2)

Spec: `docs/TECH_SPEC.md` §9.6; plan stories E11.

## Modules
| Module | Owns |
| --- | --- |
| `app` | Compose UI, navigation, DI wiring |
| `protocol` | `@Serializable` message models, tested against `protocol/fixtures` |
| `rtc` | signaling client (OkHttp WebSocket to Phoenix), `PeerConnection`, data channel |
| `pairing` | CameraX + ML Kit QR scan, confirmation code, Keystore keys |
| `audio` | `AudioRecord` (`VOICE_RECOGNITION`, 16 kHz mono PCM16), endpointing |

## Rules
- WebRTC: `io.getstream:stream-webrtc-android` at a pinned exact version; never Google's abandoned artifact.
- Keys: Android Keystore only, non-exportable; EC P-256 unless S9.1 chose Ed25519.
- The app never sends input events to the PC. Pinch-zoom is local to the video view.
- Permissions requested at the moment of use with a rationale: `CAMERA` (pairing), `RECORD_AUDIO` (first mic tap). `INTERNET` only otherwise.
- Stream stops on `Lifecycle.Event.ON_STOP`; a foreground service of type `microphone` runs only while recording.
- Coroutines + `StateFlow`; no blocking calls on the main thread; WebRTC callbacks hop to a dedicated dispatcher.
- Kotlin style: ktlint + detekt clean; unit tests for protocol, confirmation code and audio framing.

## Build and release
- `./gradlew lint ktlintCheck detekt test assembleRelease`.
- Release keystore and passwords come from CI secrets / local `keystore.properties` (gitignored). Back up the keystore: losing it forces every friend to uninstall.
- Publish the APK to GitHub Releases with its SHA-256; `versionCode` increments every release; the app checks `protocol/VERSION` compatibility with the PC on connect.
