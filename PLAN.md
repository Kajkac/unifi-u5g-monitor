# UniFi U5G Monitor Plan

## Implementirano

- U5G-only Fastify/React aplikacija na portu 8513
- SSH jump kroz UniFi gateway i automatsko otkrivanje managed SSH podataka
- strukturirani status iz `mca-dump`
- SMS Inbox/Outbox, slanje, arhiva, unread i predlošci
- allowlisted automatizacije, Timeline, povijest mjerenja i audit
- MQTT/Home Assistant i ntfy/Telegram/e-mail obavijesti
- lokalna autentikacija, rate limit, redaktirani backup i dijagnostika

## Sljedeće moguće nadogradnje

- opcionalni HTTPS/reverse-proxy deployment profil
- multi-modem podrška s potpuno odvojenim credentialima i bazama
- napredniji scheduler s vizualnim cron editorom
- eksport poruka i metrike u CSV
- PWA/mobile notification podrška
