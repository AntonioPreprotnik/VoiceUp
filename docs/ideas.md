# Parked ideas

Ideas worth keeping that aren't in the plan. Nothing here is built until it moves into `docs/PLAN.md` as a story or an AC.

## Stolen paired phone (from S9.1, parked 2026-11-09)

Antonio parked this until the phone companion works end to end: "seems like a waste of time till we have the finished product". The original v1.2 plan already has revocation (S9.6), "Ask every time" (S9.5), auto-stop and the "Phone is watching" indicator (S9.5). Those stay in the plan. What's parked is the extra protection against someone who has a paired phone in their hands.

**The risk.** Phone voice becomes a Claude prompt after the send gate. The gate stops text landing in a permission prompt, but it doesn't judge what a command asks for. So whoever holds a paired, unlocked phone during an allowed session can make Claude do anything its permission mode allows.

**Ideas, when it's time:**

- **Key needs the owner.** Require the phone owner's biometric or screen-lock PIN at least every 5 minutes for the Keystore signing key: `setUserAuthenticationParameters(300, AUTH_BIOMETRIC_STRONG | AUTH_DEVICE_CREDENTIAL)`, API 30+. A thief can't start a new session after that window. (S9.2, S11.2)
- **No voice in bypass mode.** Refuse phone voice while the latest hook says Claude's `permission_mode` is `bypassPermissions`, and show why on the phone. The recorded hooks already carry this field, e.g. `desktop/test/scenarios/agent-permission-send.json`. Hotkey voice is unaffected. (S12.2)
- **Say what auto-allow means.** Have the "Allow this phone automatically" setting say that it turns a stolen phone into remote command execution. (S9.5)
- **Tell users.** Have the install guide and pairing screen say: pair only a phone with a screen lock, and keep Claude's default permission mode. (S11.7)

The full write-up is in the history of `docs/threat-model.md`, section A1 (commit `23111e6`).
