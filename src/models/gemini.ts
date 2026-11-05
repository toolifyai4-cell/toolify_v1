/**
 * Google Gemini adapter (Google Generative Language API).
 *
 * Uses the official @google/generative-ai package.
 * Supports text chat; tool support can be added later.
 *
 * Requires a Google API key set as the environment variable `GOOGLE_API_KEY`.
 */
import { GenAI, generateContentResponse, type GenerateContentConfig } from "@google/generative-ai";
import type {
  ChatRequest,
  ChatResponse,
  FinishReason,
  ModelAdapter,
  ModelMessage,
  ToolCall,
  ToolSchema,
  Usage,
} from "../agent/types.js";

export class GeminiAdapter implements ModelAdapter {
  readonly name = "google-gemini";
  readonly modelId: string;
  private readonly apiKey: string;

  constructor(opts: { apiKey: string; model: string; pricing?: any }) {
    this.apiKey = opts.apiKey;
    this.modelId = opts.model;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const genai = new GenAI({ apiKey: this.apiKey });
    const model = genai.getGenerativeModel({ model: this.modelId });

    // Convert messages to Gemini content format.
    // Gemini expects an array of {role:string, parts:{text:string}[]}
    const geminiContents = req.messages.map((m) => {
      const parts: { text?: string }[] = [];
      if (m.content) parts.push({ text: m.content });
      // tool calls are not fully supported yet; ignore for basic chat
      return { role: m.role, parts };
    });

    const requestConfig: GenerateContentConfig = {
      // system instruction can be passed via the first user message with role 'system'
      // we'll prepend if present
    };

    // Build the full prompt: system instruction if any
    let systemInstruction: { text?: string } | undefined;
    const userMsg = geminiContents.find((m) => m.role === "user");
    const systemMsg = geminiContents.find((m) => m.role === "system");
    if (systemMsg) {
      systemInstruction = { text: systemMsg.parts[0]?.text };
      // remove system from the array so it's not sent as user message
      // (we'll just keep it; Gemini supports system instruction separately)
    }

    const result = await model.generateContent({
      contents: geminiContents.filter((m) => m.role !== "system"),
      systemInstruction,
      // we do not request tool support for now
    } as any); // cast because typings may differ

    // The response shape from the library:
    // { response: { text?: string, candidates?: ... }, usage?: { inputTokens?, outputTokens? } }
    const text = (result as any)?.response?.text ?? "";
    const usage: Usage = {
      inputTokens: (result as any)?.usage?.promptTokens ?? 0,
      outputTokens: (result as any)?.usage?.completionTokens ?? 0,
    };

    const finishReason: FinishReason =
      (result as any)?.stopReason === "STOP"
        ? "stop"
        : (result as any)?.stopReason === "MAX_TOKENS"
        ? "max_tokens"
        : "stop";

    return {
      text,
      finishReason,
      usage,
      // no tool calls for now
    };
  }
}

/** Helper to map a model ID to a display‑friendly name (optional). */
export function geminiModelDisplay(modelId: string): string {
  // Strip version suffixes for display
  return modelId.replace(/\/.*$/, "").replace(/-flash|-pro|-exp$/i, "").replace(/_/g, " ");
}