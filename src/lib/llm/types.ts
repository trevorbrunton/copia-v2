export interface StreamOptions {
  model?: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  onToken?: (token: string) => void;
  signal?: AbortSignal;
}

export interface GenerateTextOptions {
  model?: string;
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StreamResult {
  fullText: string;
  usage?: TokenUsage;
}

export interface GenerateResult {
  text: string;
  usage?: TokenUsage;
}

// AU inference profile for Haiku 4.5 in ap-southeast-2
export const DEFAULT_MODEL = "au.anthropic.claude-haiku-4-5-20251001-v1:0";
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_TEMPERATURE = 0.7;
