/**
 * services/novaAgent.js
 * Core agent reasoning service powered by Groq.
 *
 * Exposes the primary agent functions:
 *   inferIntent(context)
 *   analyzeSelection({ text, image, metadata })
 *   generateActionPlan(task, context)
 *   generateResponse(resultType, context)
 *   callGroq(opts) / callNova(opts)
 */

import {
  createChatCompletion,
  hasConfiguredCredentials,
  PRIMARY_MODEL,
  VISION_MODEL
} from "./groqClient.js";

// ── System prompts ────────────────────────────────────────────────────────────
const AGENT_SYSTEM = [
  "You are Corsiri, a cursor-native AI assistant powered by Groq.",
  "The user's selection is the context; the trigger press is their intent.",
  "Return the most useful, concise result for the selection.",
  "Honor the chosen action when provided, but execute it intelligently.",
  "Do not output internal reasoning or generic advice unless explicitly asked.",
  "If content is time-sensitive, include an explicit date qualifier."
].join(" ");

const INTENT_SYSTEM = [
  "You are the Corsiri intent router powered by Groq.",
  "Infer the most useful action from the user's current selection.",
  "Identify content type, infer user intent, choose the single best action.",
  "Prefer usefulness over rigid labels.",
  "Return strict JSON only — no markdown, no commentary."
].join(" ");

const PLAN_SYSTEM = [
  "You are the Corsiri browser action planner powered by Groq.",
  "Convert the user's intent and current browser page context into a safe executable action plan.",
  "Return strict JSON only. No markdown."
].join(" ");

// ── Low-level call helper ─────────────────────────────────────────────────────
/**
 * @param {object} opts
 * @param {string}  [opts.prompt]       - Simple text prompt
 * @param {Array}   [opts.messages]     - Full messages array
 * @param {string}  [opts.systemText]   - System instruction
 * @param {string}  [opts.model]        - Model ID override
 * @param {number}  [opts.temperature]  - 0.0–1.0
 * @param {number}  [opts.maxTokens]    - Max output tokens
 * @param {boolean} [opts.jsonMode]     - Whether to enforce JSON
 * @returns {Promise<{ text: string, model: string, latencyMs: number, usage: object }>}
 */
export async function callGroq({
  prompt,
  messages,
  systemText,
  model,
  temperature = 0.7,
  maxTokens = 2048,
  jsonMode = false
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
    temperature,
    maxTokens,
    jsonMode
  });

  if (!result.text && !result.text?.length) {
    throw new Error("Groq returned no text result.");
  }

  return {
    text: result.text.trim(),
    model: result.model,
    latencyMs: result.latencyMs,
    usage: result.usage
  };
}

// Backwards compatibility alias
export const callNova = callGroq;

// ── inferIntent ───────────────────────────────────────────────────────────────
/**
 * Infer the most useful action from a selection context.
 * @param {{ text?, imageBase64?, imageMimeType?, mode?, actionHint?, voiceCommand? }} context
 * @returns {Promise<{ contentType, bestAction, confidence, alternatives, latencyMs, model }>}
 */
export async function inferIntent(context = {}) {
  if (!hasConfiguredCredentials()) {
    return { contentType: "general_text", bestAction: "summarize", confidence: 0.5, alternatives: [] };
  }

  const {
    text = "",
    imageBase64 = "",
    imageMimeType = "image/png",
    mode = "smart",
    actionHint = "",
    voiceCommand = ""
  } = context;

  const schema = JSON.stringify({
    contentType: "question|mcq|code|email|report|product|social_caption|general_text|image",
    bestAction: "snake_case action name",
    confidence: 0.9,
    alternatives: ["3-8 distinct snake_case follow-up actions"]
  }, null, 2);

  let messages;
  let modelToUse = undefined;

  if (imageBase64 && !text) {
    // Image-only
    modelToUse = VISION_MODEL;
    messages = [{
      role: "user",
      content: [
        { type: "text", text: `Analyze this image and return the most useful action.\nReturn strict JSON matching:\n${schema}\nMode: ${mode}\nAction hint: ${actionHint || "none"}\nVoice command: ${voiceCommand || "none"}` },
        { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } }
      ]
    }];
  } else if (imageBase64 && text) {
    // Multimodal text + image
    modelToUse = VISION_MODEL;
    messages = [{
      role: "user",
      content: [
        { type: "text", text: `Use the text as primary context and the screenshot as supporting context.\nReturn strict JSON matching:\n${schema}\nMode: ${mode}\nAction hint: ${actionHint || "none"}\nVoice command: ${voiceCommand || "none"}\nSelected text:\n${text.slice(0, 7000)}` },
        { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } }
      ]
    }];
  } else {
    // Text-only
    const prompt = [
      "Infer the most useful action for this selected text.",
      `Return strict JSON matching:\n${schema}`,
      `Mode: ${mode}`,
      `Action hint: ${actionHint || "none"}`,
      `Voice command: ${voiceCommand || "none"}`,
      "Selected text:",
      text.slice(0, 9000)
    ].join("\n\n");
    messages = [{ role: "user", content: prompt }];
  }

  const result = await callGroq({
    messages,
    systemText: INTENT_SYSTEM,
    model: modelToUse,
    temperature: 0.1,
    jsonMode: true
  });

  try {
    const parsed = parseJson(result.text);
    return {
      contentType: parsed?.contentType || "general_text",
      bestAction: parsed?.bestAction || "summarize",
      confidence: Number(parsed?.confidence) || 0.85,
      alternatives: Array.isArray(parsed?.alternatives) ? parsed.alternatives : [],
      latencyMs: result.latencyMs,
      model: result.model
    };
  } catch {
    return {
      contentType: "general_text",
      bestAction: "summarize",
      confidence: 0.7,
      alternatives: [],
      latencyMs: result.latencyMs,
      model: result.model
    };
  }
}

// ── analyzeSelection ──────────────────────────────────────────────────────────
/**
 * Analyze a selection (text, image, or both) and return a result.
 * @param {{ text?, imageBase64?, imageMimeType?, action?, contentType?, voiceCommand?, metadata? }} opts
 * @returns {Promise<{ text: string, model: string, latencyMs: number, usage: object }>}
 */
export async function analyzeSelection({
  text,
  imageBase64,
  imageMimeType = "image/png",
  action = "summarize",
  contentType = "general_text",
  voiceCommand = "",
  metadata = {}
}) {
  if (!hasConfiguredCredentials()) throw new Error("GROQ_API_KEY required in .env");

  const systemText = [
    AGENT_SYSTEM,
    `Content type: ${contentType}.`,
    `Action: ${action}.`,
    "Return only the final user-facing result."
  ].join(" ");

  let messages;
  let modelToUse = undefined;

  if (imageBase64 && text) {
    modelToUse = VISION_MODEL;
    const prompt = voiceCommand?.trim()
      ? `Apply the spoken command to the selected text. Use the screenshot as supporting context.\nSpoken command: ${voiceCommand}\nSelected text:\n${text}`
      : `Perform "${action.replaceAll("_", " ")}" on the selected text. Use the screenshot as supporting context.\nSelected text:\n${text}`;
    messages = [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } }
      ]
    }];
  } else if (imageBase64) {
    modelToUse = VISION_MODEL;
    const prompt = voiceCommand?.trim()
      ? `Apply the spoken command to this image.\nVoice command: ${voiceCommand}\nReturn only the result.`
      : buildImagePrompt(action);
    messages = [{
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } }
      ]
    }];
  } else {
    const prompt = voiceCommand?.trim()
      ? `Apply the spoken command to the selected text and return only the final output.\nSpoken command: ${voiceCommand}\nSelected text:\n${text}`
      : buildTextPrompt({ text, action, contentType });
    messages = [{ role: "user", content: prompt }];
  }

  return callGroq({ messages, systemText, model: modelToUse });
}

// ── generateActionPlan ────────────────────────────────────────────────────────
/**
 * Generate a browser action plan from a task + browser context.
 * @param {string} task - Description of what to do
 * @param {{ originalText?, resultText?, action?, voiceCommand?, contentType?, browserContext? }} context
 * @returns {Promise<{ goal, summary, requiresConfirmation, steps[] }>}
 */
export async function generateActionPlan(task, context = {}) {
  if (!hasConfiguredCredentials()) throw new Error("GROQ_API_KEY required in .env");

  const { originalText = "", resultText = "", action = "", voiceCommand = "", contentType = "general_text", browserContext = {} } = context;

  const schema = JSON.stringify({
    goal: "short_snake_case_goal",
    summary: "one concise sentence describing what will happen",
    requiresConfirmation: true,
    steps: [{
      tool: "navigate|click_role|click_text|fill_label|fill_name|type_active|select_option|check_radio|check_checkbox|press_key|scroll|wait_ms|apply_answer_key",
      role: "optional aria role",
      name: "optional accessible name",
      label: "optional field label",
      text: "optional text",
      url: "optional url",
      key: "optional key",
      waitMs: 250
    }]
  }, null, 2);

  const prompt = [
    `Task: ${task}`,
    `Action: ${action || "unknown"}`,
    `Content type: ${contentType}`,
    `Voice command: ${voiceCommand || "none"}`,
    "Original selected text:",
    originalText || "(none)",
    "Generated result to apply:",
    resultText || "(none)",
    "Browser page context:",
    JSON.stringify(browserContext, null, 2),
    `Return strict JSON matching this schema:\n${schema}`
  ].join("\n\n");

  const result = await callGroq({ prompt, systemText: PLAN_SYSTEM, temperature: 0.15, jsonMode: true });
  return parseJson(result.text) ?? { goal: "browser_action", summary: "Apply result to page.", requiresConfirmation: true, steps: [] };
}

// ── generateResponse ──────────────────────────────────────────────────────────
/**
 * Generate a structured agent response envelope.
 * @param {string} resultType - e.g. "summary", "rewrite", "answer", "debug", "browser_action_plan"
 * @param {{ content, intent, action, alternatives, browserPlan?, mode? }} context
 * @returns Structured JSON response object
 */
export function generateResponse(resultType, context = {}) {
  const { content = "", intent = "", action = "", alternatives = [], browserPlan = null, mode = "smart" } = context;

  return {
    mode,
    intent,
    reasoning_summary: `Groq performed "${action || resultType}" on the selection.`,
    suggested_actions: alternatives,
    result: {
      type: resultType,
      content
    },
    browser_plan: browserPlan ?? {
      preferred_path: "current_tab",
      fallback_path: "managed_browser",
      steps: []
    }
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseJson(raw) {
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

function buildTextPrompt({ text, action, contentType }) {
  const actionLabel = (action || "summarize").replaceAll("_", " ");
  return [
    `Perform "${actionLabel}" on the selected text.`,
    `Content type: ${contentType || "general_text"}.`,
    "Return only the final result.",
    "Selected text:",
    text
  ].join("\n\n");
}

function buildImagePrompt(action) {
  const map = {
    describe_image: "Describe and summarize this image in a concise paragraph.",
    extract_key_details: "Extract the key details from this image as concise bullet points.",
    identify_objects: "Identify the main objects, entities, and labels visible in this image.",
    generate_captions: "Generate 5 concise captions for this image with varied tone.",
    extract_dominant_colors: "Identify the dominant colors with hex values and short color names.",
    ocr_extract_text: "Extract all readable text from this image, preserving structure.",
    extract_table_data: "Extract tabular data into a clean table, or return key structured fields.",
    rewrite: "Rewrite the key information from this image into a clearer concise paragraph.",
    translate: "Translate any text in this image to English and summarize key points.",
    explain: "Explain what this image contains in simple terms.",
    bullet_points: "Extract key insights from this image as concise bullet points."
  };
  return map[action] ?? `Perform "${(action || "describe").replaceAll("_", " ")}" on this image. Return concise practical output only.`;
}
