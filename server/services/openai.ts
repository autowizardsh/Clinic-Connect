import OpenAI from "openai";

const primaryApiKey = process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
const primaryBaseURL = process.env.OPENAI_BASE_URL || process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const primaryModel = process.env.CHAT_AI_MODEL || "gpt-4o-mini";

const fallbackApiKey = process.env.FALLBACK_OPENAI_API_KEY;
const fallbackBaseURL = process.env.FALLBACK_OPENAI_BASE_URL;
const fallbackModel = process.env.FALLBACK_AI_MODEL;

export const openai = new OpenAI({
  apiKey: primaryApiKey,
  baseURL: primaryBaseURL,
});

const fallbackClient = fallbackApiKey
  ? new OpenAI({ apiKey: fallbackApiKey, baseURL: fallbackBaseURL || undefined })
  : null;

export function getModel(): string {
  return primaryModel;
}

function isRetryableError(error: any): boolean {
  if (!error) return false;
  const status = error?.status || error?.response?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503) return true;
  const msg = (error?.message || "").toLowerCase();
  if (msg.includes("rate limit") || msg.includes("quota") || msg.includes("insufficient") || msg.includes("exceeded") || msg.includes("billing")) return true;
  return false;
}

export async function chatCompletion(
  params: Omit<OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming, "model"> & { model?: string }
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const model = params.model || primaryModel;

  try {
    return await openai.chat.completions.create({ ...params, model });
  } catch (error: any) {
    if (fallbackClient && fallbackModel && isRetryableError(error)) {
      console.warn(`[AI] Primary model (${model}) failed: ${error?.message || "unknown error"}. Switching to fallback (${fallbackModel})...`);
      return await fallbackClient.chat.completions.create({
        ...params,
        model: fallbackModel,
      });
    }
    throw error;
  }
}
