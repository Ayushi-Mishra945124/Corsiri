/**
 * services/novaVoice.js
 * Voice processing service powered by Groq Whisper.
 *
 * Exposes:
 *   transcribeOrProcessVoice(audioInput)  — POST /voice handler
 *   attachSonicGateway(server)            — WebSocket /live gateway
 */

import { WebSocketServer } from "ws";
import {
  createAudioTranscription,
  createChatCompletion,
  hasConfiguredCredentials,
  AUDIO_MODEL
} from "./groqClient.js";

// ── transcribeOrProcessVoice ──────────────────────────────────────────────────
/**
 * Transcribe or process a voice input.
 * Uses Groq Whisper for blazing fast audio transcription (WAV/PCM/WebM).
 *
 * @param {{ audioBase64: string, mimeType?: string }} audioInput
 * @returns {Promise<{ text: string, model: string, latencyMs: number }>}
 */
export async function transcribeOrProcessVoice({ audioBase64, mimeType = "audio/wav" }) {
  if (!hasConfiguredCredentials()) {
    throw new Error("GROQ_API_KEY required in backend/nova-agent/.env for voice processing.");
  }
  if (!audioBase64) {
    throw new Error("audioBase64 is required.");
  }

  const audioBuffer = Buffer.from(audioBase64, "base64");
  const ext = mimeType.includes("webm") ? "webm" : mimeType.includes("mp3") ? "mp3" : "wav";
  const filename = `audio.${ext}`;

  const result = await createAudioTranscription({
    audioBuffer,
    mimeType,
    filename
  });

  return {
    text: result.text,
    model: AUDIO_MODEL,
    latencyMs: result.latencyMs
  };
}

// ── attachSonicGateway ────────────────────────────────────────────────────────
/**
 * Attach live voice WebSocket gateway to the HTTP server.
 * Path: /live (configurable via CORSIRI_LIVE_VOICE_PATH)
 *
 * Client message protocol:
 *   { type: "audio_chunk", dataBase64: "...", mimeType: "..." }
 *   { type: "audio_end" }
 *   { type: "close" }
 *
 * Server message protocol:
 *   { type: "live_open" }
 *   { type: "input_transcription", text: "..." }
 *   { type: "model_text", text: "..." }
 *   { type: "turn_complete" }
 *   { type: "live_closed" }
 *   { type: "error", error: "..." }
 */
export function attachSonicGateway(server) {
  const livePath = process.env.CORSIRI_LIVE_VOICE_PATH || process.env.CURSIVIS_LIVE_VOICE_PATH || "/live";
  const wss = new WebSocketServer({ server, path: livePath });

  wss.on("connection", (socket) => {
    if (!hasConfiguredCredentials()) {
      safeSend(socket, { type: "error", error: "GROQ_API_KEY is required for voice service." });
      socket.close();
      return;
    }

    safeSend(socket, { type: "live_open" });

    const chunks = [];
    let audioMimeType = "audio/wav";

    socket.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString("utf-8"));

        if (msg.type === "audio_chunk" && msg.dataBase64) {
          chunks.push(Buffer.from(msg.dataBase64, "base64"));
          if (msg.mimeType) audioMimeType = msg.mimeType;
        } else if (msg.type === "audio_end") {
          if (chunks.length === 0) {
            safeSend(socket, { type: "turn_complete" });
            return;
          }

          const combinedBuffer = Buffer.concat(chunks);
          chunks.length = 0; // reset

          const ext = audioMimeType.includes("webm") ? "webm" : audioMimeType.includes("mp3") ? "mp3" : "wav";
          const filename = `voice_stream.${ext}`;

          try {
            const transcription = await createAudioTranscription({
              audioBuffer: combinedBuffer,
              mimeType: audioMimeType,
              filename
            });

            safeSend(socket, {
              type: "input_transcription",
              text: transcription.text
            });

            // Generate AI response
            if (transcription.text) {
              const aiResult = await createChatCompletion({
                messages: [
                  {
                    role: "system",
                    content: "You are Corsiri voice assistant. The user spoke a command. Acknowledge or answer concisely in 1-2 sentences."
                  },
                  { role: "user", content: transcription.text }
                ],
                maxTokens: 150
              });

              safeSend(socket, {
                type: "model_text",
                text: aiResult.text
              });
            }

            safeSend(socket, { type: "turn_complete" });
          } catch (err) {
            safeSend(socket, {
              type: "error",
              error: err instanceof Error ? err.message : String(err)
            });
          }
        } else if (msg.type === "close") {
          safeSend(socket, { type: "live_closed" });
          socket.close();
        }
      } catch (err) {
        safeSend(socket, { type: "error", error: "Malformed WebSocket payload" });
      }
    });

    socket.on("close", () => {
      chunks.length = 0;
    });

    socket.on("error", (err) => {
      console.warn("[live-voice] WebSocket error:", err.message);
    });
  });

  return wss;
}

function safeSend(socket, payload) {
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(payload));
  }
}
