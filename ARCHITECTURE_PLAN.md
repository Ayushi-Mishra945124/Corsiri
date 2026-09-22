# Corsiri — Architecture Plan
## Amazon Nova AI Hackathon Submission

---

## A. Project Overview

Corsiri is a cursor-native AI agent that turns any text selection, screen region, or voice command into an intelligent action powered by Amazon Nova via AWS Bedrock.

The user selects content → presses a trigger (Logitech MX Creative Console or keyboard shortcut) → the companion app captures context and sends it to the Nova Agent Backend → Nova 2 Lite reasons about the intent → the result is displayed in the orb UI and optionally executed in the browser.

---

## B. Competition

**Amazon Nova AI Hackathon** — built entirely on AWS Bedrock using Amazon Nova models.

---

## C. System Components

| Component | Technology | Role |
|---|---|---|
| Nova Agent Backend | Node.js, AWS Bedrock SDK v3 | Core AI reasoning, intent routing, action planning |
| Companion App | WPF / .NET 8 | Selection capture, orb UI, voice input, result display |
| Browser Action Agent | Playwright / Node.js | Executes browser actions in managed Chromium |
| Browser Extension | Chromium Extension (MV3) | Executes actions in the user's live logged-in tab |
| Native Messaging Host | .NET 8 | Bridge between companion app and browser extension |
| Logitech Plugin | C# / Logitech SDK | Trigger button integration via MX Creative Console |
| Shared IPC Protocol | JSON Schema | Contract between all components |

---

## 1. Nova Agent Backend

The backend is a Node.js Express server that routes all AI work through AWS Bedrock.

### 1.1 Service Layer

| Service | File | Responsibility |
|---|---|---|
| Bedrock Client | `services/bedrockClient.js` | Singleton `BedrockRuntimeClient` (eu-north-1) |
| Nova Agent | `services/novaAgent.js` | `inferIntent`, `analyzeSelection`, `generateActionPlan` |
| Nova Voice | `services/novaVoice.js` | `transcribeOrProcessVoice`, `attachSonicGateway` |
| Nova Embeddings | `services/novaEmbeddings.js` | `embedText`, `embedImage`, `rankOrEmbedContext` |

### 1.2 API Routes

| Method | Path | Handler | Description |
|---|---|---|---|
| GET | `/health` | inline | Service health check |
| POST | `/agent` | `routes/agent.js` | Main agentic endpoint — full structured Nova response |
| POST | `/analyze` | `app.js` (legacy) | Analyze text/image selection (companion app route) |
| POST | `/suggest-actions` | `app.js` (legacy) | Ranked action suggestions |
| POST | `/voice` | `routes/voice.js` | Buffered voice transcription via Nova 2 Lite |
| POST | `/plan` | `routes/plan.js` | Browser action plan generation via Nova 2 Lite |
| POST | `/embed` | `routes/embed.js` | Embed and rank context items |
| POST | `/transcribe` | `app.js` (legacy) | Audio transcription |
| POST | `/plan-browser-action` | `app.js` (legacy) | Browser action planning (legacy) |
| WS | `/live` | `services/novaVoice.js` | Nova 2 Sonic real-time bidirectional voice stream |

### 1.3 Amazon Nova Models Used

| Model ID | Role |
|---|---|
| `amazon.nova-lite-v1:0` | Text + image reasoning, intent routing, action planning, response generation |
| `amazon.nova-2-sonic-v1:0` | Real-time voice via Bedrock bidirectional streaming |
| Nova Multimodal Embeddings | Context ranking and similarity (via `/embed` endpoint) |

### 1.4 Startup Validation

On boot, `startupCheck.js` sends a small test request to Bedrock and logs:
- `[startup] Bedrock connection OK — Nova responded: "..."` on success
- Clear diagnostic on failure: missing env vars / invalid credentials / wrong region / model access issue

---

## 2. Companion App (WPF / .NET 8)

- Captures text selection via clipboard hook
- Captures screen region via lasso screenshot tool
- Sends payload to Nova Agent Backend (`/agent` or `/analyze`)
- Displays result in floating orb UI
- Supports hold-to-talk voice input (sends audio to `/voice` or `/live`)
- Supports "Take Action" mode — sends to `/plan` then forwards plan to browser layer

---

## 3. Full Pipeline

### 3.1 Text / Image Selection Flow

```
User selects text or screen region
        ↓
Companion App captures selection + mode
        ↓
POST /agent  →  Nova Agent Backend
        ↓
novaAgent.inferIntent()  →  Bedrock Nova 2 Lite
        ↓
novaAgent.analyzeSelection()  →  Bedrock Nova 2 Lite
        ↓
Structured JSON response returned
        ↓
Companion App displays result in orb UI
        ↓
(Optional) POST /plan  →  generateActionPlan()
        ↓
Browser Action Agent / Extension executes steps
```

Backend runs Nova 2 Lite for the summarize, explain, translate, debug, and draft-reply actions.

### 3.2 Voice Flow

```
User holds trigger button
        ↓
Companion App captures audio
        ↓
POST /voice  →  novaVoice.transcribeOrProcessVoice()
        ↓
Nova 2 Lite processes audio + selection context
        ↓
Result returned to companion app
```

For real-time streaming: WebSocket `/live` → Nova 2 Sonic via Bedrock bidirectional stream.

### 3.3 Browser Action Flow

```
POST /plan  →  novaAgent.generateActionPlan()
        ↓
Nova 2 Lite returns structured step list
        ↓
Browser Action Agent (Playwright) or Extension executes steps
        ↓
Result reported back to companion app
```

---

## 4. Data Flow Diagram

```
Logitech MX Trigger / Keyboard Shortcut
        |
Windows Companion App (WPF / .NET 8)
  ├── text selection capture
  ├── lasso screenshot capture
  ├── orb + result UI
  ├── smart / guided modes
  └── voice capture (hold-to-talk)
        |
Nova Agent Backend (Node.js / AWS Bedrock)
  ├── POST /agent       main agentic endpoint
  ├── POST /analyze     legacy companion route
  ├── POST /voice       buffered voice transcription
  ├── POST /plan        browser action plan generation
  ├── POST /embed       multimodal context ranking
  └── WS   /live        Nova 2 Sonic real-time voice stream
        |
AWS Bedrock
  ├── amazon.nova-lite-v1:0     (text + image reasoning)
  └── amazon.nova-2-sonic-v1:0  (real-time voice)
        |
Browser Execution Layer
  ├── Chromium extension (current logged-in tab)
  └── Local Playwright agent (managed browser fallback)
        |
Output
  ├── Result panel + clipboard copy
  ├── Optional insert / replace in active app
  └── Browser UI actions (fill, click, reply, autofill)
```

---

## 5. IPC Protocol

All inter-component communication uses JSON over HTTP or WebSocket. Schemas are defined in `shared/ipc-protocol/`.

Key message types:
- `SelectionPayload` — text, image bytes, mode, source app
- `NovaResponse` — intent, result, suggested_actions, browser_plan, latencyMs, model
- `BrowserPlan` — preferred_path, fallback_path, steps[]
- `VoicePayload` — audio bytes, selection context

---

## 6. Project Structure

```
corsiri-nova/
 backend/                     # Node.js backend (Groq AI)
    src/
       services/
          bedrockClient.js
          novaAgent.js
          novaVoice.js
          novaEmbeddings.js
       routes/
          agent.js
          voice.js
          plan.js
          embed.js
       app.js
       server.js
       startupCheck.js
    .env.example
    Dockerfile
    package.json
 desktop/
    corsiri-companion/           # WPF companion app (.NET 8)
    browser-action-agent/        # Playwright browser executor
    browser-extension-chromium/  # Chromium extension (MV3)
    browser-native-host/         # Native messaging bridge
 plugin/logitech-plugin/         # Logitech MX Creative Console (C#)
 shared/ipc-protocol/            # JSON schema contracts
 docs/
    DEPLOYMENT_AWS.md
    HACKATHON_BUILD_POST.md
    DEMO_SCENARIOS.md
    ARCHITECTURE_DIAGRAM.svg
 scripts/
    run-demo.ps1
    smoke-test.ps1
    deploy-aws.ps1
```

---

## 7. Security

- AWS credentials are never hardcoded in source files
- All credentials are injected via environment variables at runtime
- `.env` is gitignored — only `.env.example` is committed
- `AWS_BEARER_TOKEN_BEDROCK` is available but not used for primary auth — standard IAM credential auth via AWS SDK v3 is used
- No secrets appear in logs or API responses

---

## 8. Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | — | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | — | AWS secret key |
| `AWS_REGION` | `eu-north-1` | AWS region |
| `BEDROCK_TEXT_MODEL_ID` | `amazon.nova-lite-v1:0` | Nova 2 Lite model ID |
| `BEDROCK_VOICE_MODEL_ID` | `amazon.nova-2-sonic-v1:0` | Nova 2 Sonic model ID |
| `BEDROCK_EMBEDDING_MODEL_ID` | — | Embedding model ID (optional) |
| `PORT` | `8080` | Backend HTTP port |

---

## 9. Deployment

The Nova Agent Backend is containerized via Docker and deployed to **AWS App Runner** via ECR.

```
Docker build → ECR push → App Runner deploy
```

See `docs/DEPLOYMENT_AWS.md` and `scripts/deploy-aws.ps1` for full instructions.

---

## 10. Development Phases

### Phase 1 — Core Nova Integration (complete)
- AWS Bedrock SDK v3 setup
- `bedrockClient.js` singleton with `eu-north-1` region
- `novaAgent.js` — `inferIntent`, `analyzeSelection`, `generateActionPlan`
- Startup validation via `startupCheck.js`
- Live test confirmed: real Nova 2 Lite response, ~750ms latency

### Phase 2 — Voice + Embeddings (complete)
- `novaVoice.js` — buffered voice via `/voice`, real-time via `/live` WebSocket
- `novaEmbeddings.js` — context ranking via `/embed`
- Nova 2 Sonic gateway attached to HTTP server

### Phase 3 — Browser Execution (complete)
- `/plan` endpoint — Nova 2 Lite generates structured browser action plan
- Browser Action Agent (Playwright) executes steps in managed Chromium
- Chromium extension executes steps in user's live logged-in tab

### Phase 4 — Polish + Submission
- All Gemini/Google references removed from entire codebase
- README and architecture docs fully updated for Amazon Nova
- Smoke test and demo scripts updated for AWS credentials
- Pushed to `CORSIRI-1.0-AMAZON-NOVA` on GitHub

---

## 11. Example Nova Response

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

Backend returns a real Nova-generated summary — not a mock, not a Gemini response.

---

## 12. References

- [Amazon Nova Developer Guide](https://docs.aws.amazon.com/bedrock/latest/userguide/amazon-nova.html)
- [Amazon Bedrock Runtime API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModel.html)
- [AWS Bedrock Node.js SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-runtime/)
- [docs/DEPLOYMENT_AWS.md](docs/DEPLOYMENT_AWS.md)
- [docs/HACKATHON_BUILD_POST.md](docs/HACKATHON_BUILD_POST.md)
