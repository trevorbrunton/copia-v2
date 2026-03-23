import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import {
  DEFAULT_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  type StreamOptions,
  type StreamResult,
  type GenerateTextOptions,
  type GenerateResult,
} from "./types";

const client = new BedrockRuntimeClient({
  region: process.env.AWS_REGION || "ap-southeast-2",
});

export async function streamChat(options: StreamOptions): Promise<StreamResult> {
  const {
    model = DEFAULT_MODEL,
    system,
    messages,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
    onToken,
    signal,
  } = options;

  const converseMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: [{ text: m.content }],
  }));

  const command = new ConverseStreamCommand({
    modelId: model,
    system: system ? [{ text: system }] : undefined,
    messages: converseMessages,
    inferenceConfig: {
      maxTokens,
      temperature,
    },
  });

  const response = await client.send(command, {
    abortSignal: signal,
  });

  let fullText = "";
  let inputTokens = 0;
  let outputTokens = 0;

  if (response.stream) {
    for await (const event of response.stream) {
      if (signal?.aborted) break;

      if (event.contentBlockDelta) {
        const delta = event.contentBlockDelta.delta;
        if (delta && "text" in delta && delta.text) {
          fullText += delta.text;
          onToken?.(delta.text);
        }
      }

      if (event.metadata?.usage) {
        inputTokens = event.metadata.usage.inputTokens || 0;
        outputTokens = event.metadata.usage.outputTokens || 0;
      }
    }
  }

  return {
    fullText,
    usage: { inputTokens, outputTokens },
  };
}

export async function generateText(
  options: GenerateTextOptions
): Promise<GenerateResult> {
  const {
    model = DEFAULT_MODEL,
    system,
    messages,
    maxTokens = DEFAULT_MAX_TOKENS,
    temperature = DEFAULT_TEMPERATURE,
  } = options;

  const converseMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: [{ text: m.content }],
  }));

  const command = new ConverseCommand({
    modelId: model,
    system: system ? [{ text: system }] : undefined,
    messages: converseMessages,
    inferenceConfig: {
      maxTokens,
      temperature,
    },
  });

  const response = await client.send(command);

  const text =
    response.output?.message?.content?.[0]?.text || "";

  return {
    text,
    usage: {
      inputTokens: response.usage?.inputTokens || 0,
      outputTokens: response.usage?.outputTokens || 0,
    },
  };
}
