/**
 * routes/embed.js
 * POST /embed — embed and rank context items via Amazon Bedrock embeddings
 */

import { Router } from "express";
import { rankOrEmbedContext, embedText, embedImage } from "../services/novaEmbeddings.js";

const router = Router();

router.post("/", async (req, res) => {
  const { query, items, text, imageBase64 } = req.body ?? {};

  try {
    // Single embed mode
    if (!query && !items) {
      if (imageBase64) {
        const result = await embedImage(imageBase64);
        return res.json({ ...result, timestampUtc: new Date().toISOString() });
      }
      if (text) {
        const result = await embedText(text);
        return res.json({ ...result, timestampUtc: new Date().toISOString() });
      }
      return res.status(400).json({ error: "Provide query+items for ranking, or text/imageBase64 for single embed." });
    }

    // Rank mode
    if (!query || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "query and items[] are required for ranking." });
    }

    const result = await rankOrEmbedContext({ query, items });
    return res.json({ ...result, timestampUtc: new Date().toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = /ThrottlingException|429|rate limit/i.test(msg) ? 429 : 500;
    return res.status(status).json({ error: "Embedding failed.", details: msg });
  }
});

export default router;
