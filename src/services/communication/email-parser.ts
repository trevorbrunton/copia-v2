import { generateText } from "@/src/lib/llm/bedrock-client";
import { logger } from "@/src/lib/logger";

export interface ParsedHandoverEmail {
  shift_details: {
    client_name?: string;
    date?: string;
    time?: string;
    requirements?: string;
  };
  confidence: number;
  raw_text: string;
}

const PARSE_PROMPT = `You are a shift handover email parser for a home care rostering system.
Extract structured shift details from the email body below.
Return ONLY valid JSON with this exact shape:
{
  "client_name": "string or null",
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM or null",
  "requirements": "string or null",
  "confidence": 0.0-1.0
}
Do not include any other text. Parse dates relative to today.`;

export async function parseHandoverEmail(emailBody: string): Promise<ParsedHandoverEmail> {
  const sanitized = emailBody.slice(0, 2000);

  try {
    const result = await generateText({
      system: PARSE_PROMPT,
      messages: [{ role: "user", content: `Email body:\n${sanitized}` }],
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn({ emailBody: sanitized.slice(0, 100) }, "No JSON found in LLM email parse response");
      return fallbackResult(sanitized);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const confidence = typeof parsed.confidence === "number" && isFinite(parsed.confidence)
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.3;

    return {
      shift_details: {
        client_name: typeof parsed.client_name === "string" ? parsed.client_name : undefined,
        date: typeof parsed.date === "string" ? parsed.date : undefined,
        time: typeof parsed.time === "string" ? parsed.time : undefined,
        requirements: typeof parsed.requirements === "string" ? parsed.requirements : undefined,
      },
      confidence,
      raw_text: sanitized,
    };
  } catch (err) {
    logger.error({ err: String(err) }, "Email parsing failed — returning fallback");
    return fallbackResult(sanitized);
  }
}

function fallbackResult(rawText: string): ParsedHandoverEmail {
  return {
    shift_details: {},
    confidence: 0,
    raw_text: rawText,
  };
}
