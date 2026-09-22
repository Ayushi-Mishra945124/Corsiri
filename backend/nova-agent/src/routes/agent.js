/**
 * routes/agent.js
 * POST /agent — main agentic endpoint
 * Returns the structured Corsiri response schema.
 */

import { Router } from "express";
import { inferIntent, analyzeSelection, generateActionPlan, generateResponse } from "../services/novaAgent.js";

const router = Router();

router.post("/", async (req, res) => {
  const {
    text,
    imageBase64,
    imageMimeType,
    audioBase64,
    action,
    mode = "smart",
    voiceCommand,
    browserContext,
    metadata
  } = req.body ?? {};

  if (!text && !imageBase64 && !audioBase64) {
    return res.status(400).json({ error: "At least one of text, imageBase64, or audioBase64 is required." });
  }

  try {
    // 1. Infer intent
    const intentResult = await inferIntent({ text, imageBase64, imageMimeType, mode, actionHint: action, voiceCommand });

    // 2. Analyze selection
    const analysisResult = await analyzeSelection({
      text,
      imageBase64,
      imageMimeType,
      action: action || intentResult.bestAction,
      contentType: intentResult.contentType,
      voiceCommand,
      metadata
    });

    // 3. Optionally generate browser plan
    let browserPlan = null;
    if (browserContext && typeof browserContext === "object") {
      browserPlan = await generateActionPlan(intentResult.bestAction, {
        originalText: text,
        resultText: analysisResult.text,
        action: action || intentResult.bestAction,
        voiceCommand,
        contentType: intentResult.contentType,
        browserContext
      });
    }

    // 4. Build structured response
    const resultType = mapActionToResultType(action || intentResult.bestAction);
    const response = generateResponse(resultType, {
      content: analysisResult.text,
      intent: intentResult.bestAction,
      action: action || intentResult.bestAction,
      alternatives: intentResult.alternatives,
      browserPlan,
      mode
    });

    return res.json({
      ...response,
      latencyMs: analysisResult.latencyMs,
      model: analysisResult.model,
      usage: analysisResult.usage,
      timestampUtc: new Date().toISOString()
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /ThrottlingException|429|rate limit/i.test(msg) ? 429 : 500;
    return res.status(status).json({ error: "Agent request failed.", details: msg });
  }
});

function mapActionToResultType(action) {
  const map = {
    summarize: "summary",
    rewrite: "rewrite",
    answer_question: "answer",
    debug_code: "debug",
    explain: "explain",
    explain_code: "explain",
    draft_reply: "draft",
    polish_email: "draft",
    autofill: "autofill",
    plan_browser_action: "browser_action_plan"
  };
  return map[action] ?? "summary";
}

export default router;
