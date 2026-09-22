/**
 * routes/plan.js
 * POST /plan — generate a browser action plan via Nova 2 Lite
 */

import { Router } from "express";
import { generateActionPlan } from "../services/novaAgent.js";

const router = Router();

router.post("/", async (req, res) => {
  const { task, originalText, resultText, action, voiceCommand, contentType, browserContext } = req.body ?? {};

  if (!browserContext || typeof browserContext !== "object") {
    return res.status(400).json({ error: "browserContext is required." });
  }
  if (!resultText && !task) {
    return res.status(400).json({ error: "Either task or resultText is required." });
  }

  try {
    const plan = await generateActionPlan(task || action || "apply_result", {
      originalText: originalText || "",
      resultText: resultText || "",
      action: action || "",
      voiceCommand: voiceCommand || "",
      contentType: contentType || "general_text",
      browserContext
    });

    return res.json({
      ...plan,
      timestampUtc: new Date().toISOString()
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /ThrottlingException|429|rate limit/i.test(msg) ? 429 : 500;
    return res.status(status).json({ error: "Action planning failed.", details: msg });
  }
});

export default router;
