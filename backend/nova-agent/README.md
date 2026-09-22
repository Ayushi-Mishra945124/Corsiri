# Corsiri Nova Agent

Amazon Nova-powered backend for Corsiri. Powered by:

- **Nova 2 Lite** — text/multimodal analysis via Bedrock Converse API
- **Nova 2 Sonic** — real-time voice via Bedrock bidirectional streaming
- **Nova Act** — UI automation (Python SDK, separate service)

## Prerequisites

- Node.js 20+
- AWS account with Bedrock access
- Nova 2 Lite and Nova 2 Sonic models enabled in your AWS region

## AWS Credentials Setup

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Create a user or role with the `AmazonBedrockFullAccess` policy (or a scoped policy allowing `bedrock:InvokeModel` and `bedrock:InvokeModelWithBidirectionalStream`)
3. Generate an Access Key and Secret Access Key

## Enable Nova Models in Bedrock

1. Go to [Amazon Bedrock Console](https://console.aws.amazon.com/bedrock/) → Model access
2. Request access to **Amazon Nova 2 Lite** and **Amazon Nova 2 Sonic**
3. Wait for approval (usually instant)

## Nova Act API Key

1. Visit [https://nova.amazon.com/act](https://nova.amazon.com/act)
2. Sign in with your AWS account
3. Generate an API key from the dashboard

## Setup

```bash
cp .env.example .env
# Fill in your credentials in .env
npm install
node src/server.js
```

## Environment Variables

| Variable | Description |
|---|---|
| `AWS_ACCESS_KEY_ID` | AWS access key |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key |
| `AWS_REGION` | AWS region (default: `eu-north-1` / `us-east-1`) |
| `BEDROCK_TEXT_MODEL_ID` | Nova 2 Lite model ID (default: `amazon.nova-lite-v1:0` / `us.amazon.nova-lite-v1:0`) |
| `BEDROCK_VOICE_MODEL_ID` | Nova 2 Sonic model ID (default: `amazon.nova-2-sonic-v1:0`) |
| `BEDROCK_EMBEDDING_MODEL_ID` | Embedding model ID (optional) |
| `CORSIRI_ENABLE_GROUNDING` | Enable web grounding (default: `true`) |
| `CORSIRI_LIVE_VOICE_PATH` | WebSocket path for live voice (default: `/live`) |
| `PORT` | HTTP port (default: `8080`) |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/agent` | Main agentic endpoint — structured Nova response |
| POST | `/analyze` | Analyze selected text/image (legacy, companion uses this) |
| POST | `/suggest-actions` | Get action suggestions |
| POST | `/voice` | Transcribe/process voice input |
| POST | `/plan` | Generate browser action plan |
| POST | `/embed` | Embed and rank context items |
| POST | `/transcribe` | Transcribe audio (legacy) |
| POST | `/plan-browser-action` | Plan browser automation steps (legacy) |
| WS | `/live` | Nova 2 Sonic real-time voice stream |

## Docker

```bash
# From the project root
docker build -f backend/nova-agent/Dockerfile -t corsiri-nova-agent .
docker run -p 8080:8080 --env-file backend/nova-agent/.env corsiri-nova-agent
```
