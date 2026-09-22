import "../env.js";
import dns from "node:dns";
try {
  dns.setDefaultResultOrder("ipv4first");
  dns.setServers(["8.8.8.8", "1.1.1.1", ...dns.getServers()]);
} catch {}

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

export const PRIMARY_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
export const FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b";
export const VISION_MODEL = process.env.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";
export const AUDIO_MODEL = process.env.GROQ_AUDIO_MODEL || "whisper-large-v3-turbo";

export function getGroqApiKey() {
  return process.env.GROQ_API_KEY || "";
}

export function hasConfiguredCredentials() {
  const key = getGroqApiKey();
  return Boolean(key && key.startsWith("gsk_"));
}

/**
 * Creates a chat completion via Groq with automatic model fallback.
 *
 * @param {object} opts
 * @param {Array}  opts.messages          - Array of { role, content } objects
 * @param {string} [opts.model]           - Model name override
 * @param {number} [opts.temperature]     - Temperature (0.0 to 1.0)
 * @param {number} [opts.maxTokens]       - Maximum tokens to generate
 * @param {boolean} [opts.jsonMode]       - Whether to enforce JSON output
 * @returns {Promise<{ text: string, model: string, latencyMs: number, usage: object }>}
 */
export async function createChatCompletion({
  messages,
  model = PRIMARY_MODEL,
  temperature = 0.7,
  maxTokens = 2048,
  jsonMode = false
}) {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set. Please set it in backend/nova-agent/.env");
  }

  const normalizedMessages = (messages || []).map(m => {
    let content = m.content;
    if (Array.isArray(content)) {
      const textParts = content.map(part => {
        if (typeof part === "string") return part;
        if (part?.text) return part.text;
        return "";
      }).filter(Boolean);
      content = textParts.join("\n");
    } else if (typeof content !== "string") {
      content = String(content ?? "");
    }
    return {
      role: m.role === "assistant" ? "assistant" : m.role === "system" ? "system" : "user",
      content
    };
  });

  const payload = {
    model,
    messages: normalizedMessages,
    temperature,
    max_tokens: maxTokens
  };

  if (jsonMode) {
    payload.response_format = { type: "json_object" };
  }

  const startedAt = Date.now();

  async function executeRequest(selectedModel, retryCount = 0) {
    payload.model = selectedModel;
    let response;
    try {
      response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
    } catch (networkErr) {
      if (retryCount < 2) {
        await new Promise(r => setTimeout(r, 600 * (retryCount + 1)));
        return executeRequest(selectedModel, retryCount + 1);
      }
      throw networkErr;
    }

    const data = await response.json();

    if (!response.ok) {
      // If requested model is not found, attempt fallback
      if (data?.error?.code === "model_not_found" && selectedModel !== FALLBACK_MODEL) {
        console.warn(`[groqClient] Model '${selectedModel}' not accessible on this key. Falling back to '${FALLBACK_MODEL}'...`);
        return executeRequest(FALLBACK_MODEL);
      }
      const errorMsg = data?.error?.message || `Groq API error HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    const latencyMs = Date.now() - startedAt;
    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? "";
    const resolvedModel = data.model || selectedModel;

    return {
      text,
      model: resolvedModel,
      latencyMs,
      usage: {
        inputTokens: Math.max(0, parseInt(data.usage?.prompt_tokens, 10) || 0),
        outputTokens: Math.max(0, parseInt(data.usage?.completion_tokens, 10) || 0)
      }
    };
  }

  return executeRequest(model);
}

/**
 * Transcribes audio via Groq Whisper.
 *
 * @param {object} opts
 * @param {Buffer|Uint8Array} opts.audioBuffer - Raw audio data
 * @param {string} [opts.mimeType]            - Audio MIME type (e.g. 'audio/wav', 'audio/webm')
 * @param {string} [opts.filename]            - Optional filename
 * @param {string} [opts.language]            - Optional language code
 * @returns {Promise<{ text: string, latencyMs: number }>}
 */
export async function createAudioTranscription({
  audioBuffer,
  mimeType = "audio/wav",
  filename = "audio.wav",
  language
}) {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set.");
  }

  const formData = new FormData();
  const blob = new Blob([audioBuffer], { type: mimeType });
  formData.append("file", blob, filename);
  formData.append("model", AUDIO_MODEL);

  if (language) {
    formData.append("language", language);
  }

  const startedAt = Date.now();
  const response = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`
    },
    body: formData
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Groq Whisper error HTTP ${response.status}`);
  }

  return {
    text: (data.text || "").trim(),
    latencyMs: Date.now() - startedAt
  };
}
