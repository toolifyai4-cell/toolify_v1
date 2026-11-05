/**
 * AWS Bedrock adapter (via aws-sdk v3 / aws-sdk client).
 *
 * Uses the Bedrock Runtime API to call models such as Anthropic Claude,
 * Amazon Titan, AI21 Labs, etc.
 *
 * Requires AWS credentials (via environment or shared config) and the
 * region, e.g. AWS_REGION=us-east-1.
 *
 * The modelId passed in opts should be a Bedrock model identifier
 * (e.g. "anthropic.claude-3-5-sonnet-20240620-v1:0").
 */
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelCommandInput,
} from "aws-sdk/clients/bedrock-runtime";
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

export class BedrockAdapter implements ModelAdapter {
  readonly name = "aws-bedrock";
  readonly modelId: string;
  private readonly client: BedrockRuntimeClient;

  constructor(opts: { apiKey?: string; model: string; region?: string }) {
    this.modelId = opts.model;
    // Bedrock does not use an API key in the same way; we rely on AWS creds.
    // If an explicit apiKey is supplied we store it for potential signing, but
    // the client will use default credential chain.
    this.client = new BedrockRuntimeClient({ region: opts.region ?? "us-east-1" });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // Build the request body according to the target model's expected format.
    // Most Bedrock models accept a "anthropic" style message payload or a
    // Titan/Titan format. We'll support the common Anthropic‑compatible format.
    const messages = req.messages.map((m) => ({
      role: m.role,
      content: m.content ?? "",
    }));

    // Build the Bedrock payload; many models accept a "prompt" + "system" structure.
    // We'll keep it simple: use the "anthropic" chat format.
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsg = messages.find((m) => m.role === "user")!;

    const payload = {
      // @ts-ignore – model‑specific fields
      anthropic_version: "bedrock-2023-05-31",
      system: systemMsg?.content,
      messages: [
        {
          role: "user",
          content: [
            {
              text: userMsg.content,
            },
          ],
        },
      ],
      // temperature, top_p, max_tokens can be added from req if desired
      // temperature: req.temperature ?? 0.7,
      // max_tokens: req.maxOutputTokens ?? 4096,
    } as any;

    const command: InvokeModelCommandInput = {
      modelId: this.modelId,
      body: JSON.stringify(payload),
      contentType: "application/json",
      // accept whatever the model returns
    };

    const response = await this.client.send(new InvokeModelCommand(command));

    // The response body is a JSON string; parse it.
    const bodyText = response.body?.toString() ?? "{}";
    const bedrockResp = JSON.parse(bodyText);

    // Extract text; different models place the generated text under different keys.
    let text = "";
    // Anthropic‑compatible
    if (bedrockResp?.type === "text") {
      text = bedrockResp?.text ?? "";
    } else if (bedrockResp?.content?.length) {
      // Grab first text block
      for (const block of bedrockResp.content) {
        if (block?.type === "text") {
          text = block.text;
          break;
        }
      }
    } else {
      // Fallback: any string field
      text = String(bedrockResp?.content ?? bedrockResp?.generatedText ?? "");
    }

    // Estimate usage if provided
    const usage: Usage = {
      inputTokens: bedrockResp?.inputTokenCount ?? 0,
      outputTokens: bedrockResp?.outputTokenCount ?? 0,
    };

    const finishReason: FinishReason =
      bedrockResp?.stopReason === "end_turn"
        ? "stop"
        : bedrockResp?.stopReason === "max_tokens"
        ? "max_tokens"
        : "stop";

    return {
      text,
      finishReason,
      usage,
    };
  }
}