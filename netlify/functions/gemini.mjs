// Server-side proxy for Gemini. The API key lives only in the Netlify environment
// variable GEMINI_API_KEY and is never sent to the browser.

const ALLOWED_MODELS = ["gemini-2.5-flash", "gemini-3-pro-preview"];
const MAX_BODY_BYTES = 6 * 1024 * 1024;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return json(500, { error: "The AI key is not set on the server. Add GEMINI_API_KEY in Netlify environment variables." });
  }

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json(413, { error: "The request is too large." });

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: "Invalid request." });
  }

  const { model, contents, config } = body || {};
  if (!ALLOWED_MODELS.includes(model)) return json(400, { error: "This AI model is not allowed." });

  // Convert the SDK-style request into the Gemini REST format.
  const { systemInstruction, tools, ...generationConfig } = config || {};
  const payload = {
    contents: typeof contents === "string" ? [{ role: "user", parts: [{ text: contents }] }] : contents,
  };
  if (systemInstruction) payload.systemInstruction = { parts: [{ text: systemInstruction }] };
  if (tools) payload.tools = tools;
  if (Object.keys(generationConfig).length) payload.generationConfig = generationConfig;

  // Keys that start with "AQ." are Vertex AI express-mode keys: they go in the URL.
  // Keys that start with "AIza" are standard Gemini API keys: they go in a header.
  const isExpressKey = key.startsWith("AQ.");
  const url = isExpressKey
    ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent?key=${encodeURIComponent(key)}`
    : `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const headers = { "content-type": "application/json" };
  if (!isExpressKey) headers["x-goog-api-key"] = key;

  let upstream;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    return json(502, { error: "Could not reach the AI service." });
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return json(upstream.status, { error: data?.error?.message || "The AI request failed." });
  }
  return json(200, data);
};
