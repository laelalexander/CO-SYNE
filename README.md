# CO-SYNE Interface

CO-SYNE Interface is the network and user interface that connects drivers, law enforcement, emergency responders, and dispatch centers. It runs on **D2ES (Driver to Emergency Services)**, the alerting and routing layer underneath.

This repository is a working MVP of the platform:

| Capability | What it does in the MVP |
|---|---|
| **Driver alert (D2ES)** | A driver taps Medical, Crash, Vehicle fire, I'm in danger, Being pulled over, or Breakdown. The alert carries their location, vehicle, verified ID, and accessibility notes, and the location keeps streaming until the alert closes. |
| **Call routing** | A rules engine triages instantly (category, priority P1 to P3, which services), picks the nearest dispatch center, and assigns the nearest available unit per service with an ETA. When an Anthropic API key is configured, Claude runs a second-pass triage in the background. It can only add responders or raise priority, never slow down or downgrade the first dispatch. |
| **QR sticker stops** | Each enrolled driver gets a CO-SYNE sticker (bumper 11.5 × 3 in, window cling 4 × 4 in, printable at `/sticker.html`). The QR holds only a sticker link. The officer scans it from the patrol car: the driver's DMV-signed credential opens in the officer's heads-up console, and the driver's phone shows the verified officer, the reason for the stop, and a video call request. The whole stop can then run over video and voice without either party leaving their vehicle. |
| **Heads-up console** | One screen for the officer: docked live video, license, vehicle, insurance, records checks (license, registration, insurance, warrants, stolen vehicle; simulated), suggested violations, and an auto-drafted report narrative. |
| **Ticketing and reports** | The officer issues a warning or citation (statute, fine, court date, pay-by date) signed with the patrol device key. It arrives on the driver's phone, where the driver signs an acknowledgement of receipt (not an admission) and can pay (simulated) or contest. Filing the report seals it with a SHA-256 hash, closes the stop, and makes it available to dispatch to view and print. |
| **Dispatch oversight** | Dispatch sees every stop live on the map with the officer's position, who is on the call, the call status, and tickets, and can drop in to any session with video and voice. |
| **Mutual identity verification at traffic stops** | Officers hold an agency-signed credential and drivers hold a DMV-signed credential, each bound to an Ed25519 key that never leaves the device. At a stop, both sign a one-time challenge. The driver sees the officer's verified name, badge, and agency (checked by the server **and** independently on the driver's phone) before anyone approaches. The officer sees the verified license, registration, insurance, and any accessibility notes only after the driver chooses to share them. |
| **Impersonation and revocation** | If an officer's proof fails (forged, expired, or revoked credential, or a copied credential without its key), the driver gets a red warning with safety guidance and dispatch is alerted. The driver can also press "Something feels wrong" at any time to open a P1 alert tied to the stop. Dispatch can revoke a credential instantly. |
| **Live video and text** | WebRTC video between driver, officer, and dispatch for any alert or stop, with text chat for deaf or hard-of-hearing drivers. The server relays only the connection setup; media flows peer to peer. |
| **Tamper-evident evidence** | Every alert, routing decision, identity check, video join, chat message, and recording hash is written to an append-only, SHA-256 hash-chained ledger, and each entry is signed with the ledger's Ed25519 key. Recordings stay on the device that made them; their SHA-256 is anchored in the ledger so any later edit is detectable. `GET /api/ledger/verify` re-checks the whole chain. |
| **Urban and rural coverage** | Demo geography includes a metro dispatch center and a rural county center with their own units. Routing uses the nearest center and adjusts ETAs for rural roads. |

## Tulsa PD pilot: three applications

CO-SYNE runs as three separate applications that talk over the CO-SYNE network:

| App | Path | What it is |
|---|---|---|
| **Driver** | `/driver/` | The driver's phone app: wallet ID, vehicle, registration and insurance, SOS, tickets, and the full-screen "You are being pulled over" alert with the verified officer card, a FaceTime-style video call, and text chat. Installable on a phone (Add to Home Screen). |
| **Officer terminal** | `/officer/` | A frameless desktop "operating system" for the patrol terminal: lock screen, desktop, taskbar and start menu, with Scanner, Traffic stop console, Map, Records lookup, CAD, Messages, Citations, Reports, Evidence, Video and Settings apps. |
| **Dispatch** | `/dispatch/` | The network operations center: live map, stop and call queue, unit status, drop-in video, records, citations and reports, connected devices, the signed evidence ledger, and the credential trust registry. |

Pilot data uses Tulsa geography (Tulsa 911 and TCSO North), Tulsa PD, Tulsa County Sheriff's Office and Service Oklahoma as credential issuers, and Oklahoma Title 47 violations.

## Run it on one computer

Requires Node.js 20 or newer.

```bash
npm install
npm run app                     # starts the server and opens all three apps
npm run app -- officer --kiosk  # one app; --kiosk runs the officer terminal full screen
npm start                       # server only: http://localhost:3000
```

On Windows, double-click `CO-SYNE.cmd` (all three), or `CO-SYNE Driver.cmd`, `CO-SYNE Officer Terminal.cmd`, `CO-SYNE Dispatch.cmd`. Each app opens as its own frameless Chrome or Edge window with its own profile, so each keeps its own device key like a separate device. `CO-SYNE (hosted).cmd` opens the apps against the hosted server at `https://iobeacons.com/cosyne` instead of starting one locally (or set `COSYNE_SERVER` yourself).

### Demo walk-through

1. **Dispatch**: sign in with any name and the access code (prefilled in demo mode).
2. **Officer terminal**: pick a pilot officer on the lock screen (Dana Rivera, Riverside 212).
3. **Driver phone**: choose "Use a demo driver" and pick Maria Gonzalez (plate MGZ-452, expired registration, Deaf).
4. Officer: open **Scanner**, scan the sticker (or use a simulated sticker image), pick a reason and start the stop.
5. The driver's phone shows the pull-over alert; accept the video call. Dispatch can **Drop in** for a three-way call.
6. Officer issues the eCitation and files the report; the driver acknowledges and pays (simulated); dispatch sees all of it in the ledger.

`/demo.html` shows all three apps side by side in one browser window. Set `COSYNE_DEMO=off` to disable sample identities (the `/api/samples` endpoint returns sample private keys and must not be enabled in production).

Device keys use WebCrypto Ed25519, which needs a secure context (HTTPS or `localhost`) and a current browser (Chrome or Edge 137+, Firefox 129+, Safari 17+).

## Host it for demos from separate computers

The `deploy/` folder installs CO-SYNE behind an existing web server at `https://iobeacons.com/cosyne/`:

```bash
# on the server, from the project folder
sudo bash deploy/install.sh
```

It installs Node 22 and coturn if missing, copies the app to `/opt/cosyne`, writes `/etc/cosyne/cosyne.env` with random access codes and a TURN secret, and runs the `cosyne` systemd service on `127.0.0.1:3100`. Then add `deploy/nginx-cosyne.conf` to the iobeacons.com HTTPS server block (Apache and Caddy versions are included) and reload the web server. Open UDP/TCP 3478 and UDP 49160-49200 for the TURN relay so video connects across cellular and office networks.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` | Listen address |
| `PUBLIC_URL` | request origin | Public base URL, e.g. `https://iobeacons.com/cosyne`; used in sticker QR codes |
| `DISPATCH_TOKEN` | `dispatch-demo` | Dispatch console access code |
| `OFFICER_ENROLL_CODE` | `officer-demo` | Agency enrollment code for officer credentials |
| `TURN_URLS` / `TURN_SECRET` | unset | TURN relay (coturn `use-auth-secret`); clients get 12-hour credentials |
| `ICE_SERVERS` | Google STUN | JSON array of extra WebRTC ICE servers |
| `TLS_CERT` / `TLS_KEY` | unset | Serve HTTPS directly, without a reverse proxy |
| `ANTHROPIC_API_KEY` | unset | Turns on Claude second-pass triage (`claude-opus-5-5`, low effort, structured JSON output, server-side refusal fallback) |
| `COSYNE_AI_ROUTING` | auto | `off` to disable AI triage, `claude` to force it on with other Anthropic credentials |
| `COSYNE_DEMO` | on | `off` disables sample identities, sample stickers, and `/api/samples` |

Runtime data (keys and the ledger) is written to `data/`, which is git-ignored.

## Tests

```bash
npm test                 # unit + API/WebSocket end-to-end tests
npm start &              # then, in another shell:
npm run test:browser     # three browser contexts: scan, pull-over alert, 3-way video, chat, citation, payment, report, ledger
BASE_URL=https://iobeacons.com/cosyne npm run test:browser   # against a deployment
```

## Architecture

```
 Driver app ─┐                          ┌─ Officer app
   (browser) │  REST + WebSocket        │  (browser)
             ▼                          ▼
        ┌───────────────── CO-SYNE server (Node.js) ─────────────────┐
        │ Identity service   trust registry, credential issue/verify,│
        │                    challenge-response, revocation           │
        │ D2ES routing       rules triage → Claude second pass,       │
        │                    nearest center + nearest unit per service│
        │ Realtime hub       sessions, live location, rooms,          │
        │                    WebRTC signaling relay, chat             │
        │ Evidence ledger    hash chain + Ed25519 signatures (JSONL)  │
        └─────────────────────────────▲──────────────────────────────┘
                                      │
                               Dispatch console (map, queue, video)
        Media: peer-to-peer WebRTC between participants (server never sees video)
```

| Path | Contents |
|---|---|
| `src/app.js` | HTTP API, WebSocket hub, alert and stop workflows |
| `src/identity.js` | Issuers, credentials, presentations, revocation |
| `src/routing.js` | Rules triage, Claude triage, unit and center selection |
| `src/samples.js` | Sample drivers, officers, stop reasons, simulated records checks |
| `src/ticketing.js` | Violation catalog, citations, incident reports |
| `src/ledger.js` | Hash-chained, signed evidence ledger |
| `public/canonical.js` | Canonical JSON and challenge format shared by server and browser |
| `public/app.js`, `public/lib/` | Driver, officer, dispatch, and ledger UI; device keys; WebRTC |

### Key API endpoints

| Method and path | Who | Purpose |
|---|---|---|
| `GET /api/trust` | anyone | Trust registry (issuer public keys) |
| `POST /api/enroll` | demo | Issue a driver or officer credential to a device public key |
| `POST /api/alerts` | driver (or anonymous) | Create a D2ES alert. Anonymous alerts are accepted and flagged unverified, so an emergency is never blocked. |
| `POST /api/alerts/:id/status` | dispatch, assigned officer, owning driver (cancel) | Status updates |
| `POST /api/stops` · `/:id/prove` · `/:id/end` · `/:id/report` | officer, driver | Traffic stop lifecycle |
| `GET /s/:stickerId` · `/api/stickers/:id` · `/api/stickers/:id/qr.svg` | officer · anyone · anyone | Sticker scan link, sticker info, printable QR |
| `POST /api/stops/:id/call` | driver | Accept or decline the officer's video call |
| `GET /api/violations` | anyone | Violation catalog and stop reasons |
| `POST /api/stops/:id/citations` | officer (device-signed) | Issue a warning or citation |
| `POST /api/citations/:id/ack` · `/pay` · `/contest` | driver | Signed acknowledgement, simulated payment, contest |
| `POST /api/stops/:id/file-report` · `GET /api/reports/:id` | officer · officer, dispatch | File the sealed incident report and close the stop |
| `POST /api/credentials/:id/revoke` | dispatch | Revoke a credential and end its sessions |
| `POST /api/evidence` | any signed-in party | Anchor a recording's SHA-256 to an alert or stop |
| `GET /api/ledger` · `/verify` · `/key` | signed in · anyone · anyone | Read, verify, and get the ledger key |

WebSocket `/ws`: the server sends a nonce, and the client signs in by signing it with its device key (dispatch uses its token). After that, the client sends `location`, `join`/`leave` (room `alert:<id>` or `stop:<id>`), `signal` (WebRTC), and `chat`. The server pushes `alert`, `stop`, `state`, `room_peers`, `peer_joined`, `peer_left`, `signal`, and `chat`.

## What's needed before production

This MVP shows the full flow end to end. A production deployment also needs:

- **Real issuers.** Agencies and the DMV run their own issuers (or a standard such as ISO 18013-5 mobile driver's licenses or W3C Verifiable Credentials) after their own identity checks, and CO-SYNE holds only the trust registry. The demo issuers and enrollment codes here are for testing.
- **Key custody.** Use HSM or KMS keys for the ledger signer, and hardware-backed keys (Secure Enclave or StrongBox via native apps) for devices.
- **Persistent storage and scale.** Move alerts, stops, and sessions to a database. Add periodic external anchoring of the ledger head (for example to a public blockchain or an RFC 3161 timestamp authority), and real dispatch auth (SSO and per-dispatcher accounts).
- **Payments and courts.** A real payment processor and court case management integration in place of the simulated payment.
- **Integrations.** NG911/CAD, AVL for real unit positions, DMV and NCIC lookups, and a TURN server for video.
- **Policy work.** Legal, privacy (CJIS, state law), and accessibility reviews, plus a data retention policy.
