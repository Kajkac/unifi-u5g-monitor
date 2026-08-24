# Changelog

## 0.2.1 — 2026-08-24

- Fixed the "Update now" result showing as a duplicate toast (once from the direct response, once from the broadcast event).

## 0.2.0 — 2026-08-24

- Added a first-run setup wizard (gateway host, SSH password, admin password) shown instead of the login screen until configured.
- Added Docker support (`Dockerfile`, `docker-compose.yml`, container healthcheck).
- Added GitHub Actions CI (lint, build, Docker build).
- Added CSV export for SMS history and signal metrics.
- Added an in-app update checker with a manual "Update now" action and this changelog panel under Settings > About.
- Added a command palette (Ctrl/Cmd+K) for quick navigation and actions.
- Added UniFi branding (logo, device photo, favicon) and a logout button.
- Toast notifications now stack instead of replacing each other.
- Richer empty states across SMS and Timeline views.
- Fixed the device model label falling back to a hardcoded placeholder instead of the detected model.
- Fixed a literal `\n` rendering in the Diagnostics view instead of a line break.
- Fixed the setup screen card being clamped to the login card's narrower width.

## 0.1.0 — 2026-08-24

- Initial standalone UniFi U5G application, independent of any legacy modem integrations.
- Added SSH jump host support, UniFi managed credential discovery, and structured `mca-dump` status.
- Added SMS Inbox/Outbox, templates, automations, Timeline, and SQLite archive.
- Added signal/WAN/system dashboard, MQTT/Home Assistant discovery, and notifications.
- Added local authentication, rate limiting, redacted backup export, and safe diagnostics.
