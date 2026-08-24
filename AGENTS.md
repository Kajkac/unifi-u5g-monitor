# UniFi U5G Monitor — Agent Guide

## Arhitektura

- `server/index.ts`: Fastify API, auth, polling i WebSocket
- `server/u5g.ts`: U5G `mca-dump`, SMS i UniFi managed credential discovery
- `server/ssh-jump.ts`: gateway -> modem SSH tunnel
- `server/database.ts`: SQLite poruke, mjerenja, događaji i audit
- `server/automations.ts`: allowlisted SMS pravila
- `src/App.tsx`: shell i navigacija
- `src/views.tsx`: Overview, Signal, WAN, System i MQTT
- `src/sms.tsx`, `src/automations.tsx`, `src/timeline.tsx`, `src/settings.tsx`: funkcionalne cjeline
- `config/settings.json`: lokalni runtime config; nikad ne commitati

## Pravila

- Ovo je U5G-only projekt. Ne uvoditi kod, nazive ni workflowe drugih modema.
- Nema API-ja za proizvoljne shell naredbe.
- Shell argumente za SMS uvijek quoteati kroz postojeći helper.
- Ne spremati UniFi-managed modem credentials; koristiti ih samo u memoriji.
- Ne prikazivati potpuni IMEI, ICCID, EID ili tajne u API-ju, logovima i backupu.
- Za timeout slanja koristiti `unknown`, bez automatskog retryja.
- Svaka automatizacija mora imati cooldown, dnevni limit i audit zapis.
- Prije predaje pokrenuti `npm run lint` i `npm run build`.
