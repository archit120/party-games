export const DEFAULT_AI_MODEL = "z-ai/glm-5.3-flash";
export const MAX_BOTS = 4;
export const AI_NAMES = ["Ada · AI", "Basil · AI", "Cora · AI", "Dorian · AI"];
// Extracted from Secret Hitler. Callers supply a seat-redacted context, never a room.
export async function completeJSON({
  apiKey,
  model = DEFAULT_AI_MODEL,
  system,
  context,
  title = "Party games",
  maxTokens = 700,
  temperature = 0.6,
  timeout = 12000,
  fetchImpl = fetch,
  baseURL = "https://openrouter.ai/api/v1",
}) {
  const input = JSON.stringify(context);
  if (input.length > 22000) throw Error("AI context limit");
  const response = await fetchImpl(baseURL + "/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": title,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: input },
      ],
      max_tokens: maxTokens,
      temperature,
      reasoning: model.includes("glm")
        ? { effort: "low", exclude: true }
        : { enabled: false },
      response_format: { type: "json_object" },
      provider: {
        require_parameters: true,
        max_price: { prompt: 0.2, completion: 0.6 },
      },
    }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw Error(`AI service HTTP ${response.status}`);
  const result = await response.json(),
    content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw Error("AI returned no decision");
  return {
    parsed: JSON.parse(content),
    cost:
      typeof result.usage?.cost === "number" &&
      Number.isFinite(result.usage.cost) &&
      result.usage.cost >= 0
        ? result.usage.cost
        : null,
  };
}
