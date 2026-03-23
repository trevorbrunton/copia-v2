import { NextRequest } from "next/server";
import { requireAuthContext } from "@/src/server/require-auth-context";
import { makeDeps } from "@/src/server/make-deps";
import { streamChat } from "@/src/lib/llm/bedrock-client";
import { createSSEResponse } from "@/src/lib/sse";
import { executeToolCall, executeWriteToolCall, isWriteTool, TOOL_DEFINITIONS, WRITE_TOOL_DEFINITIONS } from "@/src/services/rostering/chat-tools";
import { handleAppError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

const SYSTEM_PROMPT = `You are a rostering assistant for a home care organisation. You help coordinators query shift filling, task status, employee availability, and metrics. You can also perform actions when asked.

You have access to these read tools:
${TOOL_DEFINITIONS.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

You also have access to these write tools (require user confirmation):
${WRITE_TOOL_DEFINITIONS.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

When a user asks about task status, metrics, or recent tasks, call the appropriate tool by responding with a JSON block:
\`\`\`tool_call
{"tool": "tool_name", "args": {"param": "value"}}
\`\`\`

For write actions, the user will be asked to confirm before the action is executed.
After receiving tool results, summarise them conversationally for the user.`;

export async function POST(req: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const deps = makeDeps();

    const body = await req.json();
    const messages: Array<{ role: "user" | "assistant"; content: string }> = body.messages ?? [];

    // Validate confirmed_action if present — must be a known write tool
    let confirmedAction: { tool: string; args: Record<string, unknown> } | undefined;
    if (body.confirmed_action && typeof body.confirmed_action === "object") {
      const { tool, args } = body.confirmed_action;
      if (typeof tool === "string" && isWriteTool(tool) && args && typeof args === "object") {
        confirmedAction = { tool, args: args as Record<string, unknown> };
      }
      // Silently ignore invalid confirmed_action — treat as normal chat
    }

    if (messages.length === 0) {
      return Response.json(
        { error: { code: "VALIDATION_ERROR", message: "messages array is required", traceId } },
        { status: 400 }
      );
    }

    // If this is a confirmed write action, execute it directly
    if (confirmedAction && isWriteTool(confirmedAction.tool)) {
      return createSSEResponse(async (send) => {
        try {
          const writeResult = await deps.uow.run(ctx, async ({ db: tx }) => {
            return executeWriteToolCall(tx, ctx.principalId, confirmedAction.tool, confirmedAction.args);
          });

          send({ type: "tool_result", ...writeResult });

          // Stream a follow-up summarising the result
          const followUpMessages = [
            ...messages,
            { role: "user" as const, content: `Action confirmed and executed. Result: ${JSON.stringify(writeResult.result)}` },
          ];

          await streamChat({
            system: SYSTEM_PROMPT,
            messages: followUpMessages,
            onToken: (token) => { send({ type: "token", content: token }); },
          });
        } catch (err) {
          logger.error({ traceId, err: String(err) }, "Chat write action failed");
          send({ type: "error", message: "Write action failed" });
        }
      });
    }

    return createSSEResponse(async (send) => {
      // Stream LLM response
      const result = await streamChat({
        system: SYSTEM_PROMPT,
        messages,
        onToken: (token) => {
          send({ type: "token", content: token });
        },
      });

      // Check if response contains a tool call
      const toolMatch = result.fullText.match(/```tool_call\s*\n(\{[\s\S]*?\})\s*\n```/);

      if (toolMatch) {
        try {
          const toolCall = JSON.parse(toolMatch[1]);

          // Write tools need user confirmation before executing
          if (isWriteTool(toolCall.tool)) {
            send({ type: "confirmation_required", tool: toolCall.tool, args: toolCall.args });
            send({
              type: "usage",
              inputTokens: result.usage?.inputTokens ?? 0,
              outputTokens: result.usage?.outputTokens ?? 0,
            });
            return;
          }

          send({ type: "tool_call", tool: toolCall.tool, args: toolCall.args });

          // Execute read tool call
          const toolResult = await deps.readOnly.run(ctx, async ({ db: tx }) => {
            return executeToolCall(tx, ctx.principalId, toolCall.tool, toolCall.args ?? {});
          });

          send({ type: "tool_result", ...toolResult });

          // Stream a follow-up response with tool results
          const followUpMessages = [
            ...messages,
            { role: "assistant" as const, content: result.fullText },
            { role: "user" as const, content: `Tool result: ${JSON.stringify(toolResult.result)}` },
          ];

          const followUp = await streamChat({
            system: SYSTEM_PROMPT,
            messages: followUpMessages,
            onToken: (token) => {
              send({ type: "token", content: token });
            },
          });

          send({
            type: "usage",
            inputTokens: (result.usage?.inputTokens ?? 0) + (followUp.usage?.inputTokens ?? 0),
            outputTokens: (result.usage?.outputTokens ?? 0) + (followUp.usage?.outputTokens ?? 0),
          });
        } catch (err) {
          logger.error({ traceId, err: String(err) }, "Chat tool call failed");
          send({ type: "error", message: "Tool call failed" });
        }
      } else {
        send({
          type: "usage",
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
        });
      }
    });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
