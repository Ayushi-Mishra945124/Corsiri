# Corsiri — Cursor-Native AI Agent powered by Amazon Nova

> **Selection = Context · Trigger = Intent · Nova = Intelligence**

Built for the **Amazon Nova AI Hackathon** on AWS Bedrock.

Corsiri turns your cursor into an AI agent. Select text, an image, or a UI region — press a trigger — and Amazon Nova reasons about what you selected, returns the most useful result, and optionally executes it directly in your browser.

---

## Amazon Nova Models

| Model | Role |
|---|---|
| Nova 2 Lite (`amazon.nova-lite-v1:0`) | Text + image reasoning, intent routing, action planning, response generation |
| Nova 2 Sonic (`amazon.nova-2-sonic-v1:0`) | Real-time voice via Bedrock bidirectional streaming |
| Nova Multimodal Embeddings | Context ranking and similarity (via `/embed` endpoint) |

---

## What Corsiri Does

- **Select text** — Nova summarizes, rewrites, translates, explains, debugs, or drafts a reply
- **Select an image / lasso a screen region** — Nova describes, extracts, or analyzes it
- **Hold to talk** — Nova 2 Sonic transcribes your voice command and applies it to the selection
- **Press Take Action** — Nova generates a browser action plan and executes it in your real logged-in tab

All of this happens in under 3 seconds for typical inputs.

---

## Architecture

```
Logitech MX Trigger / Mock Trigger
        |
Windows Companion App (WPF / .NET 8)
  - text selection capture
  - lasso screenshot capture
  - orb + result UI
  - smart / guided modes
  - voice capture (hold-to-talk)
        |
Nova Agent Backend (Node.js / AWS Bedrock)
  - POST /agent       main agentic endpoint
  - POST /analyze     legacy companion route
  - POST /voice       buffered voice transcription
  - POST /plan        browser action plan generation
  - POST /embed       multimodal context ranking
  - WS   /live        Nova 2 Sonic real-time voice stream
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
corsiri-nova/
 backend/                     # Node.js backend (Groq AI)
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
 plugin/logitech-plugin/      # Logitech MX Creative Console integration (C#)
 shared/ipc-protocol/         # JSON schema contracts
 docs/                        # Architecture, deployment, build post
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
```
[startup] Validating AWS Bedrock connection...
[startup]  Bedrock connection OK — Nova responded: "..."
[nova-agent] Listening on http://127.0.0.1:8080
```

### 3. Test it

```bash
curl -X POST http://localhost:8080/agent \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"Amazon Nova is a new family of frontier models from AWS.\",\"mode\":\"smart\"}"
```

### 4. Full demo stack

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\run-demo.ps1 `
  -AwsAccessKeyId "<KEY>" `
  -AwsSecretAccessKey "<SECRET>" `
  -AwsRegion "eu-north-1"
```

Starts: Nova backend, browser action agent, companion app.

### 5. Smoke test

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\smoke-test.ps1 `
  -AwsAccessKeyId "<KEY>" `
  -AwsSecretAccessKey "<SECRET>" `
  -AwsRegion "eu-north-1"
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | — | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | — | AWS secret key |
| `AWS_REGION` | `eu-north-1` | AWS region |
| `BEDROCK_TEXT_MODEL_ID` | `amazon.nova-lite-v1:0` | Nova 2 Lite model ID |
| `BEDROCK_VOICE_MODEL_ID` | `amazon.nova-2-sonic-v1:0` | Nova 2 Sonic model ID |
| `BEDROCK_EMBEDDING_MODEL_ID` | — | Embedding model ID (optional) |
| `PORT` | `8080` | Backend HTTP port |

> If `eu-north-1` returns a model access error, use `AWS_REGION=us-east-1` and `BEDROCK_TEXT_MODEL_ID=us.amazon.nova-lite-v1:0`

---

## API Reference

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Service health check |
| POST | `/agent` | Main agentic endpoint — full structured Nova response |
| POST | `/analyze` | Analyze text/image selection (companion app route) |
| POST | `/suggest-actions` | Get ranked action suggestions |
| POST | `/voice` | Buffered voice transcription via Nova 2 Lite |
| POST | `/plan` | Generate browser action plan via Nova 2 Lite |
| POST | `/embed` | Embed and rank context items |
| POST | `/transcribe` | Audio transcription (legacy) |
| POST | `/plan-browser-action` | Browser action planning (legacy) |
| WS | `/live` | Nova 2 Sonic real-time bidirectional voice stream |

### Example `/agent` response

```json
{
  "mode": "smart",
  "intent": "summarize_text",
  "reasoning_summary": "Nova 2 Lite performed \"summarize_text\" on the selection.",
  "suggested_actions": ["translate_text", "explain", "bullet_points"],
  "result": {
    "type": "summary",
    "content": "Amazon Nova is AWS's new frontier model family offering advanced intelligence and top price performance."
  },
  "browser_plan": {
    "preferred_path": "current_tab",
    "fallback_path": "managed_browser",
    "steps": []
  },
  "latencyMs": 750,
  "model": "amazon.nova-lite-v1:0",
  "usage": { "inputTokens": 162, "outputTokens": 18 }
}
```

---

## AWS Deployment

See [docs/DEPLOYMENT_AWS.md](docs/DEPLOYMENT_AWS.md) for full instructions.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-aws.ps1 `
  -AwsAccountId "123456789012" `
  -AwsAccessKeyId "<KEY>" `
  -AwsSecretAccessKey "<SECRET>" `
  -Region "eu-north-1"
```

Deploys to AWS ECR + App Runner.

---

## Docs

- [ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md) — full system design
- [docs/HACKATHON_BUILD_POST.md](docs/HACKATHON_BUILD_POST.md) — how it was built
- [docs/DEPLOYMENT_AWS.md](docs/DEPLOYMENT_AWS.md) — AWS deployment guide
- [docs/DEMO_SCENARIOS.md](docs/DEMO_SCENARIOS.md) — demo walkthrough scenarios
