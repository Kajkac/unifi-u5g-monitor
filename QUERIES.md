# U5G Monitor — brze smjernice

- Status ili signal: `server/u5g.ts` + `src/views.tsx`
- SSH jump ili UniFi credentials: `server/ssh-jump.ts` + `server/u5g.ts`
- SMS parser/arhiva/slanje: `server/u5g.ts`, `server/database.ts`, `src/sms.tsx`
- Automatizacije: `server/automations.ts` + `src/automations.tsx`
- MQTT/HA: `server/mqtt.ts` + `src/views.tsx` + `src/settings.tsx`
- Auth/config: `server/config.ts` + `server/index.ts` + `src/login.tsx`
- API i WebSocket: `server/index.ts`

Provjera nakon promjene:

```bash
npm run lint
npm run build
curl http://127.0.0.1:8513/api/health
```
