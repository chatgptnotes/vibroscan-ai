# VibrationCheck — SCADA Vibration Graph AI Analyzer (MVP)

Capture, verify, and analyze industrial SCADA vibration graphs with Gemini Vision & Reasoning models, based on the **Brüel & Kjær Vibro Diagnostic Chart**.

Mobile-first **PWA** (camera + bilingual speech-to-text) → **Express** API → two-tier AI pipeline:

- **Tier 1 — Verification Guardrail:** Gemini Flash (JSON mode) verifies the image is a legitimate vibration graph; non-graphs are rejected with HTTP 400.
- **Tier 2 — Diagnostic Engine:** Gemini Pro (or GLM-4V/z.ai) runs the B&K rule base and returns a structured Markdown diagnostic report.

---

## 1. Architecture

```
[ Mobile UI — Vite + React PWA ]
  ├── Camera capture & file upload (client-side compression ≤1600px / JPEG 0.8)
  ├── Bilingual Speech-to-Text (Web Speech API: en-IN / en-US / hi-IN)
  └── Dynamic Markdown report render (react-markdown)
         │  HTTPS POST multipart/form-data
         ▼
[ Express Node.js Backend (server/) ]
  ├── Multer upload + Sharp server-side normalization
  ├── Tier 1: Gemini Flash verification (JSON)  → 400 if not a graph
  └── Tier 2: Gemini Pro / GLM-4V diagnostic reasoning (B&K rule base)
```

```
VibrationCheck/
├── client/   # Vite + React PWA
│   ├── public/   (manifest.json, sw.js, icon.svg → generated PNGs)
│   └── src/      (App, AppBody, components, lib)
├── server/   # Express + Gemini SDK + Sharp
│   ├── src/      (config, routes, services, prompts, middleware, utils)
│   └── scripts/  (generate-icons.mjs)
└── instructions.md
```

---

## 2. Setup

### Prerequisites
- Node.js 18+ (tested on Node 26)

### 2.1 Backend
```bash
cd server
npm install
cp .env.example .env      # then edit .env and paste your keys
```

Open `server/.env` and set:
- `GEMINI_API_KEY` — required (https://aistudio.google.com/app/apikey)
- `GLM_API_KEY` — optional, only if `DIAGNOSTIC_PROVIDER=glm` (https://z.ai)
- `DIAGNOSTIC_PROVIDER` — `gemini` (default) or `glm`

### 2.2 Frontend
```bash
cd client
npm install
```

### 2.3 Generate PWA icons (once)
```bash
cd server
npm run make-icons     # writes client/public/icon-192.png, icon-512.png, favicon.png
```

---

## 3. Run (local dev)

Run **both** in separate terminals:

```bash
# Terminal 1 — API
cd server
npm run dev            # http://localhost:3001  (Vite proxies /api here)

# Terminal 2 — Web app
cd client
npm run dev            # http://localhost:5173
```

Open http://localhost:5173 on your phone (same network) or desktop. STT requires a
secure context — use `localhost`, or serve over HTTPS in production.

> Health check: `GET http://localhost:3001/health`

---

## 4. How it works

1. **Capture** — Take a photo or upload a chart. The browser compresses it to ≤1600px JPEG q0.8 before upload.
2. **Verify (Tier 1)** — Gemini Flash returns `{"is_legitimate": bool, "reason": str}`. If `false`, the API returns HTTP 400 and the UI shows a clear "Image not recognized" message.
3. **Diagnose (Tier 2)** — On pass, the diagnostic engine receives the image (Gemini) plus the injected **B&K rule base** as a system prompt + operator notes, and **streams** a Markdown report (live "typing" in the UI) covering Graph Classification, Key Spectral Findings, Diagnostic Findings & Fault Identification, and Severity & Recommendations.

### Endpoints
```
POST /api/analyze-vibration   (non-streaming; returns full JSON)
POST /api/analyze-stream      (Server-Sent Events; used by the web UI)
multipart/form-data:
  image:       File   (required)
  description: string (optional)
```

Success (200):
```json
{ "success": true, "verified": true, "report": "...markdown...", "provider": "gemini", "model": "gemini-flash-latest" }
```
Rejected (400):
```json
{ "success": false, "verified": false, "error": "...", "reason": "..." }
```

---

## 5. Build & deploy

```bash
# Frontend production build
cd client
npm run build          # outputs client/dist/
npm run preview        # preview the production build
```

- **Frontend:** deploy `client/dist` to **Vercel / Netlify / Render static site**. Set `VITE_API_URL` to your deployed backend URL in the host's env settings (or `client/.env` before build).
- **Backend:** deploy `server/` to **Render / Railway / Fly.io / a Node host**. Set the same env vars as in `.env.example`. The API enables CORS, so it can live on a different domain.

### Hybrid Web-to-APK fallback
The web app is a valid PWA (manifest + service worker + icons). For an `.apk`:
1. Deploy the frontend to a live HTTPS URL.
2. Run that URL through **PWABuilder** (https://pwabuilder.com) → generates an APK/TWA in minutes.
   - *Or* wrap the `client/dist` build with **Capacitor**: `npx cap init && npx cap add android && npx cap build android`.

---

## 6. Environment variables

### `server/.env`
| Var | Required | Default | Purpose |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | yes (gemini) | — | Google AI Studio key |
| `GEMINI_VERIFICATION_MODEL` | no | `gemini-flash-latest` | Tier-1 verification model |
| `GEMINI_DIAGNOSTIC_MODEL` | no | `gemini-flash-latest` | Tier-2 diagnostic model |
| `GLM_API_KEY` | yes (glm) | — | z.ai Coding Plan key |
| `GLM_MODEL` | no | `glm-4.6` | GLM model name |
| `GLM_BASE_URL` | no | `https://api.z.ai/api/coding/paas/v4` | Coding-Plan endpoint (NOT the PAYG `/api/paas/v4`) |
| `GLM_MAX_TOKENS` | no | `16000` | output cap (reasoning models need generous budget) |
| `DIAGNOSTIC_PROVIDER` | no | `gemini` | `gemini` \| `glm` |
| `PORT` | no | `3001` | server port |
| `MAX_IMAGE_WIDTH` | no | `1600` | server downscale limit |
| `MAX_UPLOAD_BYTES` | no | `15728640` | upload size cap |
| `REQUEST_TIMEOUT_MS` | no | `120000` | upstream model request timeout |

### `client/.env`
| Var | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | ` ` (empty) | Backend base URL; empty = same origin / Vite proxy in dev |

---

## 7. Notes & limitations (MVP)
- Diagnostic numbers (frequencies/amplitudes) are **AI estimates** from the image and must be validated against actual sensor data.
- Web Speech API support varies by browser (best on Chrome/Edge). The UI gracefully degrades to typed input.

### ⚠️ Model & quota notes (read before a live demo)
- **Gemini:** on current Google AI keys, `gemini-1.5-*` and `gemini-2.5-*` are **decommissioned** (404). The defaults use `gemini-flash-latest`, which auto-resolves to the newest available Flash model (currently `gemini-3.6-flash`) and supports vision + JSON mode. The **free tier caps Flash at ~20 requests/day/project** — **enable billing on your Google AI project** to lift this to thousands/day before a demo.
- **GLM (z.ai Coding Plan):** confirmed working — the Coding Plan key is text-only (no vision) and requires its **dedicated endpoint** `https://api.z.ai/api/coding/paas/v4` (or the Anthropic-compatible `https://api.z.ai/api/anthropic`). Using the standard PAYG endpoint (`/api/paas/v4`) returns `429 Insufficient balance`. Set `DIAGNOSTIC_PROVIDER=glm` to run the two-hop pipeline: **Gemini Vision extracts a structured graph description → GLM reasons over it** (deep multi-step reasoning). GLM models are *reasoning models* (they emit a separate `reasoning_content` chain-of-thought), so `GLM_MAX_TOKENS=16000` ensures the report completes. Per z.ai's terms, the Coding Plan quota is intended for supported coding tools — verify your usage complies, or use the z.ai API Platform (PAYG) for production app traffic.
- **Pro models** (`gemini-pro-latest`) are available in the catalog but tier-limited (403/429) for many free accounts — switch via `GEMINI_DIAGNOSTIC_MODEL` if your account allows.
- All model names are env-configurable, so you can repoint to newer models without code changes.

### Diagnostic scripts (server/scripts/)
- `npm run check-keys` — live-probe both providers (auth + a tiny inference + GLM model list).
- `node scripts/smoke.mjs reject|chart` — POST a synthetic non-graph / FFT chart to `/api/analyze-vibration`.
- `node scripts/smoke-stream.mjs` — POST a synthetic FFT chart to `/api/analyze-stream` and print the SSE events.
- `npm run make-icons` — regenerate PWA icons from `client/public/icon.svg`.
