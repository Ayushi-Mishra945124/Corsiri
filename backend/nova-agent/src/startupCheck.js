/**
 * startupCheck.js
 * Validates Groq API credentials and connectivity at server startup.
 * Sends a minimal test request and logs the result.
 */

import {
  getGroqApiKey,
  PRIMARY_MODEL,
  FALLBACK_MODEL,
  createChatCompletion
} from "./services/groqClient.js";

export async function validateGroqConnection() {
  console.log("[startup] Validating Groq API connection...");

  const apiKey = getGroqApiKey();
  if (!apiKey) {
    console.error("[startup] ✗ Missing GROQ_API_KEY environment variable.");
    console.error("[startup]   Set GROQ_API_KEY in backend/nova-agent/.env");
    console.error("[startup]   Server will start but AI requests will fail until configured.");
    return;
  }

  const maskedKey = apiKey.length > 8 ? `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}` : "***";
  console.log(`[startup] API Key : ${maskedKey}`);
  console.log(`[startup] Model   : ${PRIMARY_MODEL} (fallback: ${FALLBACK_MODEL})`);

  try {
    const result = await createChatCompletion({
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 8,
      temperature: 0.1
    });

    console.log(`[startup] ✓ Groq connection OK — Model: ${result.model} responded in ${result.latencyMs}ms: "${result.text.trim()}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[startup] ✗ Groq connection FAILED: ${msg}`);
    console.error("[startup]   Server will start but AI requests may fail.");
  }
}

// Backwards-compatible alias for any existing imports
export const validateBedrockConnection = validateGroqConnection;
