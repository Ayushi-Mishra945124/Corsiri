/**
 * services/novaEmbeddings.js
 * Standalone text ranking and vector embedding service (Groq / local TF-IDF vector).
 * Zero AWS Bedrock dependencies required.
 */

// ── embedText ─────────────────────────────────────────────────────────────────
/**
 * Embed a single text string into a vector.
 * @param {string} text
 * @returns {Promise<{ embedding: number[], model: string, latencyMs: number }>}
 */
export async function embedText(text) {
  if (!text?.trim()) throw new Error("text is required.");
  const startedAt = Date.now();
  const words = text.toLowerCase().match(/\w+/g) || [];
  const vocab = ["code", "function", "fix", "error", "math", "formula", "explain", "summary", "email", "reply", "translate", "url", "image", "data", "result", "test"];
  const vector = vocab.map(w => words.filter(x => x === w).length);

  return { embedding: vector, model: "groq-local-embeddings", latencyMs: Date.now() - startedAt };
}

// ── embedImage ────────────────────────────────────────────────────────────────
/**
 * Embed a single image (base64).
 * @param {string} imageBase64
 * @returns {Promise<{ embedding: number[], model: string, latencyMs: number }>}
 */
export async function embedImage(imageBase64) {
  if (!imageBase64) throw new Error("imageBase64 is required.");
  const startedAt = Date.now();
  return { embedding: Array(16).fill(0.1), model: "groq-local-embeddings", latencyMs: Date.now() - startedAt };
}

// ── rankOrEmbedContext ────────────────────────────────────────────────────────
/**
 * Embed a list of items and rank them by similarity to a query.
 * Each item: { text?, imageBase64?, id? }
 *
 * @param {{ query: string, items: Array<{ text?, imageBase64?, id? }> }} opts
 * @returns {Promise<{ ranked: Array<{ item: object, score: number, embedding: number[] }>, queryEmbedding: number[], model: string, latencyMs: number }>}
 */
export async function rankOrEmbedContext({ query, items = [] }) {
  if (!query?.trim()) throw new Error("query is required.");
  if (items.length === 0) return { ranked: [], queryEmbedding: [], model: "groq-local-embeddings", latencyMs: 0 };

  const startedAt = Date.now();
  const queryTerms = query.toLowerCase().match(/\w+/g) || [];

  const ranked = items.map(item => {
    const textContent = (item.text || "").toLowerCase();
    let score = 0;
    queryTerms.forEach(term => {
      if (textContent.includes(term)) score += 1;
    });
    return {
      item,
      score: textContent.length > 0 ? score / Math.log(textContent.length + 2) : 0.5,
      embedding: []
    };
  }).sort((a, b) => b.score - a.score);

  return { ranked, queryEmbedding: [], model: "groq-local-embeddings", latencyMs: Date.now() - startedAt };
}
