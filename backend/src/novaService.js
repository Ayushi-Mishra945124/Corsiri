/**
 * novaService.js
 * Amazon Nova 2 Lite text/multimodal service via
 * the Amazon Bedrock Converse API.
 *
 * Exports the same three factory functions the rest of the app expects:
 *   createNovaTextGenerator()
 *   createNovaIntentRouter()
 *   createNovaOptionGenerator()
 */

import {
  createChatCompletion,
  hasConfiguredCredentials,
  PRIMARY_MODEL
} from "./services/groqClient.js";
import {
  buildIntentRouterPrompt,
  inferUsefulCodeAction,
  inferFallbackType,
  normalizeActionHint,
  normalizeIntentDecision
} from "./contentClassifier.js";

// ─── Model IDs ────────────────────────────────────────────────────────────────
const DEFAULT_LITE_MODEL = PRIMARY_MODEL;

// ─── System instructions (same semantics as before) ───────────────────────────
const EXECUTION_SYSTEM_INSTRUCTION = [
  "You are Corsiri, a cursor-native AI assistant.",
  "Selection is the context, trigger press is the user's intent.",
  "Return the most useful result for that selection.",
  "Honor the chosen action when provided, but execute it intelligently.",
  "Be decisive, concise, and useful by default.",
  "Do not output internal reasoning or generic advice unless explicitly asked.",
  "If content is time-sensitive, use grounded facts and include an explicit date."
].join(" ");

const INTENT_ROUTER_SYSTEM_INSTRUCTION = [
  "You are the Corsiri intent router.",
  "Infer the most useful action from the user's current selection.",
  "First identify the content type, then infer likely user intent, then choose the single best action.",
  "Prefer usefulness over rigid labels.",
  "Return strict JSON only — no markdown, no commentary."
].join(" ");

const DYNAMIC_OPTIONS_SYSTEM_INSTRUCTION = [
  "You generate additional action options for Guided Mode in Corsiri.",
  "Start from the selected content, infer what other useful operations a user may want next.",
  "Return only practical, concise, executable follow-up actions.",
  "Do not repeat existing options.",
  "Return strict JSON only."
].join(" ");

// ─── Cache helpers ─────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 200;

function readCache(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.value;
}

function writeCache(cache, key, value) {
  cache.set(key, { createdAt: Date.now(), value });
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

// ─── JSON parser ───────────────────────────────────────────────────────────────
function parseJsonObject(raw) {
  if (!raw?.trim()) return null;
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  const s = candidate.indexOf("{");
  const e = candidate.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(candidate.slice(s, e + 1)); } catch { return null; }
}

function parseActionListFromJson(raw) {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.extraActions) ? raw.extraActions
    : Array.isArray(raw?.actions) ? raw.actions
    : Array.isArray(raw?.alternatives) ? raw.alternatives
    : [];
  return arr
    .map(v => normalizeActionHint(String(v)))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i);
}

// ─── Bedrock Converse helper ───────────────────────────────────────────────────
/**
 * Calls Nova 2 Lite via the Bedrock Converse API.
 * Supports text-only and multimodal (image) messages.
 *
 * @param {object} opts
 * @param {string} [opts.prompt]          - Simple text prompt (text-only path)
 * @param {Array}  [opts.messages]        - Full Converse messages array (multimodal path)
 * @param {string} [opts.systemText]      - System instruction text
 * @param {string} [opts.model]           - Model ID override
 * @param {number} [opts.temperature]     - 0.0–1.0
 * @param {string} [opts.responseMimeType]- Ignored (kept for API compat)
 * @returns {{ text: string, model: string, latencyMs: number, usage?: object }}
 */
async function callNova({
  prompt,
  messages,
  systemText,
  model = DEFAULT_LITE_MODEL,
  temperature = 0.7
}) {
  const reqMessages = [];
  if (systemText) {
    reqMessages.push({ role: "system", content: systemText });
  }

  if (messages && messages.length > 0) {
    reqMessages.push(...messages);
  } else if (prompt) {
    reqMessages.push({ role: "user", content: prompt });
  }

  const result = await createChatCompletion({
    messages: reqMessages,
    model,
    temperature
  });

  return {
    text: result.text.trim(),
    model: result.model,
    latencyMs: result.latencyMs,
    usage: result.usage
  };
}

// ─── Text Generator ────────────────────────────────────────────────────────────
export function createNovaTextGenerator({
  model = DEFAULT_LITE_MODEL
} = {}) {
  if (!hasConfiguredCredentials()) {
    return async () => { throw new Error("GROQ_API_KEY is required to call Groq."); };
  }

  const cache = new Map();

  return async ({
    prompt,
    contents,   // multimodal path: Converse messages array
    messages,   // chat messages path
    selectionType,
    action,
    systemText: customSystemText,
    config = {}
  }) => {
    const startedAt = Date.now();
    const resolvedModel = config.modelOverride || model;

    // Build system instruction
    const systemText = customSystemText || [
      EXECUTION_SYSTEM_INSTRUCTION,
      `Detected content type: ${selectionType || "general_text"}.`,
      `Chosen action: ${action || "unspecified_action"}.`,
      "Return only the final user-facing result."
    ].join(" ");

    // Cache key (text-only path only)
    const cacheKey = typeof prompt === "string" && prompt.trim() && prompt.length <= 12000
      ? JSON.stringify({ model: resolvedModel, prompt, temperature: config.temperature ?? 0.7 })
      : null;

    const cached = cacheKey ? readCache(cache, cacheKey) : null;
    if (cached) return { ...cached, latencyMs: Math.max(1, Date.now() - startedAt), cached: true };

    const finalMessages = messages || contents;

    const result = await callNova({
      prompt: typeof prompt === "string" ? prompt : undefined,
      messages: finalMessages,
      systemText,
      model: resolvedModel,
      temperature: config.temperature ?? 0.7
    });

    if (cacheKey) writeCache(cache, cacheKey, result);
    return result;
  };
}

// ─── Intent Router ─────────────────────────────────────────────────────────────
function fallbackIntentDecision({ selectionKind, text }) {
  if (selectionKind === "image") {
    return {
      contentType: "image",
      bestAction: "describe_image",
      confidence: 0.7,
      alternatives: ["describe_image", "extract_key_details", "identify_objects", "extract_dominant_colors"]
    };
  }
  const contentType = inferFallbackType(text || "");
  const bestAction = contentType === "code" ? inferUsefulCodeAction(text || "") : null;
  return normalizeIntentDecision({ contentType, bestAction, confidence: 0.7, alternatives: [] }, text || "");
}

export function createNovaIntentRouter({
  model = process.env.NOVA_ROUTER_MODEL || DEFAULT_LITE_MODEL
} = {}) {
  if (!hasConfiguredCredentials()) {
    return async ({ selectionKind = "text", text = "" }) => fallbackIntentDecision({ selectionKind, text });
  }

  const cache = new Map();

  return async ({
    selectionKind = "text",
    text = "",
    imageBase64 = "",
    imageMimeType = "image/png",
    mode = "smart",
    actionHint = "",
    voiceCommand = ""
  }) => {
    const startedAt = Date.now();

    const cacheKey = selectionKind === "text" && text.trim()
      ? `intent:${mode}:${actionHint}:${voiceCommand}:${text.trim().slice(0, 9000)}`
      : null;
    const cached = cacheKey ? readCache(cache, cacheKey) : null;
    if (cached) return { ...cached, latencyMs: Math.max(1, Date.now() - startedAt), cached: true };

    try {
      let messages;

      if (selectionKind === "image" && imageBase64) {
        // Image-only routing
        messages = [{
          role: "user",
          content: [
            {
              text: [
                "You are the Corsiri image intent router.",
                "Analyze the image and decide the most useful next AI action.",
                "Return strict JSON only:",
                JSON.stringify({
                  contentType: "image",
                  bestAction: "snake_case action e.g. describe_image",
                  confidence: 0.0,
                  alternatives: ["3-8 distinct snake_case actions"]
                }, null, 2),
                `Mode: ${mode}`,
                `Action hint: ${actionHint || "none"}`,
                `Voice command: ${voiceCommand || "none"}`
              ].join("\n\n")
            },
            {
              image: {
                format: (imageMimeType || "image/png").replace("image/", ""),
                source: { bytes: Buffer.from(imageBase64, "base64") }
              }
            }
          ]
        }];
      } else if (selectionKind === "text_image" && imageBase64) {
        // Text + screenshot routing
        messages = [{
          role: "user",
          content: [
            {
              text: [
                "You are the Corsiri multimodal intent router.",
                "Use the text as primary context and the screenshot as supporting context.",
                "Return strict JSON only:",
                JSON.stringify({
                  contentType: "question|mcq|code|email|report|product|social_caption|general_text",
                  bestAction: "short snake_case action name",
                  confidence: 0.0,
                  alternatives: ["3-8 distinct snake_case actions"]
                }, null, 2),
                `Mode: ${mode}`,
                `Action hint: ${actionHint || "none"}`,
                `Voice command: ${voiceCommand || "none"}`,
                "Selected text:",
                text.trim().slice(0, 7000)
              ].join("\n\n")
            },
            {
              image: {
                format: (imageMimeType || "image/png").replace("image/", ""),
                source: { bytes: Buffer.from(imageBase64, "base64") }
              }
            }
          ]
        }];
      } else {
        // Text-only routing
        messages = [{
          role: "user",
          content: [{ text: buildIntentRouterPrompt({ text, mode, actionHint, voiceCommand }) }]
        }];
      }

      const result = await callNova({
        messages,
        systemText: INTENT_ROUTER_SYSTEM_INSTRUCTION,
        model,
        temperature: 0.1
      });

      const parsed = parseJsonObject(result.text);
      const normalized = selectionKind === "image"
        ? { ...(parsed || {}), contentType: "image" }
        : parsed;
      const decision = {
        ...normalizeIntentDecision(normalized, text),
        latencyMs: Date.now() - startedAt,
        model
      };

      if (cacheKey) writeCache(cache, cacheKey, decision);
      return decision;
    } catch {
      return { ...fallbackIntentDecision({ selectionKind, text }), latencyMs: Date.now() - startedAt, model };
    }
  };
}

// ─── Option Generator ──────────────────────────────────────────────────────────
export function createNovaOptionGenerator({
  model = process.env.NOVA_OPTIONS_MODEL || DEFAULT_LITE_MODEL
} = {}) {
  if (!hasConfiguredCredentials()) return async () => [];

  const cache = new Map();

  return async ({
    selectionKind = "text",
    text = "",
    imageBase64 = "",
    imageMimeType = "image/png",
    contentType = "general_text",
    currentOptions = []
  }) => {
    const normalizedCurrent = currentOptions.map(v => normalizeActionHint(String(v))).filter(Boolean);

    const cacheKey = selectionKind === "text" && text.trim()
      ? `options:${contentType}:${normalizedCurrent.join(",")}:${text.trim().slice(0, 6000)}`
      : null;
    const cached = cacheKey ? readCache(cache, cacheKey) : null;
    if (cached) return cached;

    try {
      const optionsPrompt = [
        "You generate additional executable action options for a contextual AI menu.",
        "Return strict JSON only:",
        JSON.stringify({ extraActions: ["3-8 new snake_case action names, different from current options"] }, null, 2),
        `Content type: ${contentType}`,
        `Current options: ${normalizedCurrent.join(", ") || "none"}`,
        "Rules: Do not repeat existing options. Keep actions concise and executable.",
        selectionKind !== "image" ? `Selection text:\n${text.trim().slice(0, 7000)}` : ""
      ].filter(Boolean).join("\n\n");

      let messages;
      if ((selectionKind === "image" || selectionKind === "text_image") && imageBase64) {
        messages = [{
          role: "user",
          content: [
            { text: optionsPrompt },
            {
              image: {
                format: (imageMimeType || "image/png").replace("image/", ""),
                source: { bytes: Buffer.from(imageBase64, "base64") }
              }
            }
          ]
        }];
      } else {
        messages = [{ role: "user", content: [{ text: optionsPrompt }] }];
      }

      const result = await callNova({
        messages,
        systemText: DYNAMIC_OPTIONS_SYSTEM_INSTRUCTION,
        model,
        temperature: 0.35
      });

      const parsed = parseJsonObject(result.text);
      const generated = parseActionListFromJson(parsed)
        .filter(a => !normalizedCurrent.includes(a))
        .slice(0, 10);

      if (cacheKey) writeCache(cache, cacheKey, generated);
      return generated;
    } catch {
      return [];
    }
  };
}
