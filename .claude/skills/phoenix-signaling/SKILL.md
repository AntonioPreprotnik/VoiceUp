---
name: phoenix-signaling
description: Conventions for VoiceUp's v1.2 signaling server (Elixir, Phoenix 1.8 Channels, TURN relay, Docker Compose deploy). Use when working anywhere in server/.
paths:
  - "server/**"
---

# Signaling server (v1.2)

Spec: `docs/TECH_SPEC.md` §9.2 and §9.5; plan stories E8.

## Shape
- Plain Phoenix app (`mix phx.new server --no-html --no-assets --no-mailer --no-dashboard`), Channels only. No LiveView, no Ecto unless a pair registry needs persistence (start with ETS or a small SQLite via `ecto_sqlite3`, decided in S8.2).
- `VoiceUpWeb.DeviceSocket`: `connect/3` verifies `{device_id, ts, sig}` — signature over `"voiceup-auth|" <> device_id <> "|" <> ts` with the stored public key, `ts` within ±60 s, replay cache keyed on `{device_id, ts}` with 120 s TTL.
- `VoiceUpWeb.DeviceChannel` on `"device:" <> id`; `join/3` only for the socket's own device id.
- Forward `sdp:offer`, `sdp:answer`, `ice`, `session:request` only between registered pairs; validate payload shape and size (SDP ≤ 16 KB). Never persist message bodies.
- `turn:credentials` replies with `%{username, credential, ttl: 600, urls}` computed from the shared secret in runtime config (env var, never committed).

## Practices
- Config in `config/runtime.exs` from env vars; secrets via the host, not the repo.
- Rate limits per IP and per device (e.g. `hammer`) on connect, pair and session requests.
- Logs: device ids and event names only; no SDP, ICE or keys; retention 7 days.
- Tests: `Phoenix.ChannelTest` for connect auth (valid, expired ts, replayed ts, bad sig), routing between paired devices, refusal for unpaired ones, oversized payloads. `mix test`, `mix format --check-formatted`, `mix credo --strict` must pass.

## Deploy (`server/deploy/`)
Docker Compose: `app` (release built with `mix release`), relay (coturn or eturnal per S8.1, `use-auth-secret`, private IP ranges denied as relay peers), `caddy` (TLS for the signaling domain). Firewall: 443/tcp, relay ports only. Document redeploy from scratch in `server/deploy/README.md`.
