# Corsiri — Cursor-Native AI Agent powered by Groq LPU

> **Selection = Context · Trigger = Intent · Groq = Ultra-Fast Intelligence**

Corsiri turns your cursor into an AI agent. Select text, an image, or a UI region — press a trigger — and Groq AI reasons about what you selected, returns the most useful result, and optionally executes it directly in your browser in under 600ms.

---

## Groq LPU AI Models

| Model | Role |
|---|---|
| GPT-OSS 120B (`openai/gpt-oss-120b`) | Primary text reasoning, intent routing, action planning, and response generation |
| GPT-OSS 20B (`openai/gpt-oss-20b`) | Ultra-fast fallback model for sub-second responses |
| Qwen 3.8 27B Vision (`qwen/qwen3.8-27b`) | Screen capture region analysis, multimodal vision, and diagram extraction |
| Whisper Turbo (`whisper-large-v3-turbo`) | High-speed voice transcription and hold-to-talk voice commands |

---

## What Corsiri Does

- **Select text** — Groq summarizes, rewrites, translates, explains, debugs, or drafts a reply.
- **Context-Aware "Fix It"** — Automatically detects Code (Fix bug), Math (Fix calculation), Email (Fix tone), or Writing (Fix grammar).
- **Select an image / lasso a screen region** — Groq Vision describes, extracts text, or solves formulas visually.
- **Hold to talk** — Groq Whisper transcribes your voice command and applies it directly to the selection.
- **Press Take Action** — Groq generates a browser action plan and executes it in your real logged-in tab.

All of this happens in sub-second latency powered by Groq LPU inference.

---

## Architecture

```
Logitech MX Trigger / Mock Trigger / Global Hotkey (Ctrl+Shift+Space)
        |
Windows Companion App (WPF / .NET 8)
  - text selection capture
  - lasso screenshot capture
  - orb + result UI
  - smart / guided modes
  - voice capture (hold-to-talk)
        |
Corsiri Agent Backend (Node.js / Groq LPU API)
  - POST /agent       main agentic endpoint
  - POST /analyze     legacy companion route
  - POST /voice       Groq Whisper voice transcription
  - POST /plan        browser action plan generation
  - POST /embed       context ranking and similarity
  - WS   /live        real-time voice gateway
        |
Browser Execution Layer
  - Chromium extension (current logged-in tab)
  - Local Playwright agent (managed browser fallback)
        |
Output
  - Result panel + clipboard copy
  - Optional insert / replace in active app
  - Browser UI actions (fill, click, reply, autofill)
```

---

## Project Structure

```
corsiri/
 backend/                     # Node.js backend (Groq LPU API)
    src/
       services/            # Modular service layer
          groqClient.js        # Singleton Groq client
          novaAgent.js         # inferIntent, analyzeSelection, generateActionPlan
          novaVoice.js         # transcribeOrProcessVoice, attachSonicGateway
          novaEmbeddings.js    # embedText, embedImage, rankOrEmbedContext
       routes/              # Express route handlers
          agent.js             # POST /agent
          voice.js             # POST /voice
          plan.js              # POST /plan
          embed.js             # POST /embed
       app.js               # Express app + legacy routes
       server.js            # HTTP server + startup validation
       startupCheck.js      # Groq connectivity check on boot
    .env.example
    Dockerfile
    package.json
 desktop/
    corsiri-companion/       # WPF companion app (.NET 8)
    browser-action-agent/    # Playwright browser executor
    browser-extension-chromium/  # Chromium extension
    browser-native-host/     # Native messaging bridge
 plugin/                     # Logitech MX Creative Console integration (C#)
 shared/ipc-protocol/         # JSON schema contracts
 docs/                        # Architecture and demo scenarios
 scripts/                     # run-demo.ps1, smoke-test.ps1
```

---

## Quick Start

### Prerequisites

- Windows 10 or 11
- Node.js 20+
- .NET 8 SDK
- Groq API Key (`gsk_...`)

### 1. Configure credentials

```bash
cp .env.example .env
# Fill in GROQ_API_KEY in .env
```

### 2. Start the backend

```bash
cd backend
npm install
node src/server.js
```

On startup you will see:
```text
[startup] Validating Groq API connection...
[startup] API Key : gsk_HyO...0Tqj
[startup] Model   : openai/gpt-oss-120b (fallback: openai/gpt-oss-20b)
[startup] ✓ Groq connection OK — Model: openai/gpt-oss-120b responded in 463ms
[nova-agent] Listening on http://127.0.0.1:8080
```

### 3. Test it

```bash
curl -X POST http://localhost:8080/agent \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"Groq is an ultra-fast LPU inference engine.\",\"mode\":\"smart\"}"
```

### 4. Full demo stack

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-demo.ps1 -GroqApiKey "gsk_..."
```

Starts: Corsiri backend, browser action agent, companion app.

### 5. Smoke test

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-test.ps1 -GroqApiKey "gsk_..."
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `GROQ_API_KEY` | — | Groq LPU API Key (`gsk_...`) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Primary Groq model ID |
| `GROQ_FALLBACK_MODEL` | `openai/gpt-oss-20b` | Fallback Groq model ID |
| `GROQ_VISION_MODEL` | `qwen/qwen3.8-27b` | Vision model ID |
| `GROQ_AUDIO_MODEL` | `whisper-large-v3-turbo` | Audio transcription model ID |
| `PORT` | `8080` | Backend HTTP port |

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service health check |
| POST | `/agent` | Main agentic endpoint — full structured Groq response |
| POST | `/analyze` | Analyze text/image selection (companion app route) |
| POST | `/suggest-actions` | Get ranked action suggestions |
| POST | `/voice` | Groq Whisper voice transcription |
| POST | `/plan` | Generate browser action plan |
| POST | `/embed` | Context ranking and similarity |

### Example `/agent` response

```json
{
  "mode": "smart",
  "intent": "summarize_text",
  "reasoning_summary": "Groq performed \"summarize_text\" on the selection.",
  "suggested_actions": ["translate_text", "explain", "bullet_points"],
  "result": {
    "type": "summary",
    "content": "Groq provides sub-second LPU inference for real-time AI assistance."
  },
  "browser_plan": {
    "preferred_path": "current_tab",
    "fallback_path": "managed_browser",
    "steps": []
  },
  "latencyMs": 463,
  "model": "openai/gpt-oss-120b",
  "usage": { "inputTokens": 162, "outputTokens": 18 }
}
```

---

## Docs

- [ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md) — full system design
- [docs/DEMO_SCENARIOS.md](docs/DEMO_SCENARIOS.md) — demo walkthrough scenarios
