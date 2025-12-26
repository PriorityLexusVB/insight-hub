type ChatMessage = { role: "system" | "user"; content: string };

export type OpenRouterChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

export async function openRouterChatComplete(params: {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Export it in your shell before running summarize --mode llm."
    );
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      // Optional but recommended by OpenRouter:
      "HTTP-Referer": "http://localhost",
      "X-Title": "insight-hub-indexer",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.max_tokens ?? 800,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter error: ${res.status} ${res.statusText}\n${text}`
    );
  }

  const data = (await res.json()) as OpenRouterChatResponse;
  const content = data?.choices?.[0]?.message?.content ?? "";
  return content;
}
