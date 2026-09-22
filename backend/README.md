# Corsiri Backend Agent

Groq LPU-powered backend service for Corsiri. Powered by:

- **GPT-OSS 120B / 20B** — ultra-fast text reasoning, intent routing, and response generation
- **Qwen 3.8 27B Vision** — multimodal image and screen capture analysis
- **Whisper Turbo** — sub-second audio transcription & voice commands

## Prerequisites

- Node.js 20+
- Groq LPU API Key (`gsk_...`)

## Setup

```bash
# From project root
cp .env.example .env
# Fill in GROQ_API_KEY in .env

cd backend
npm install
node src/server.js
```

## Environment Variables

| Variable | Description |
|---|---|
| `GROQ_API_KEY` | Groq LPU API key (`gsk_...`) |
| `GROQ_MODEL` | Primary text model (default: `openai/gpt-oss-120b`) |
| `GROQ_FALLBACK_MODEL` | Fallback model (default: `openai/gpt-oss-20b`) |
| `GROQ_VISION_MODEL` | Multimodal vision model (default: `qwen/qwen3.8-27b`) |
| `GROQ_AUDIO_MODEL` | Voice transcription model (default: `whisper-large-v3-turbo`) |
| `PORT` | HTTP port (default: `8080`) |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/agent` | Main agentic endpoint — structured Groq response |
| POST | `/analyze` | Analyze selected text/image |
| POST | `/suggest-actions` | Get action suggestions |
| POST | `/voice` | Transcribe/process voice input via Groq Whisper |
| POST | `/plan` | Generate browser action plan |
| POST | `/embed` | Context ranking and similarity |

## Docker

```bash
# From the project root
docker build -f backend/Dockerfile -t corsiri-agent .
docker run -p 8080:8080 --env-file .env corsiri-agent
```
