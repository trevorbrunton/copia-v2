import { eq, asc } from "drizzle-orm";
import {
  demoResponses,
  demoQuestionPatterns,
  type DemoResponse,
  type DemoQuestionPattern,
} from "@/src/db/schema";
import type { TransactionClient } from "@/src/lib/tenant";

export async function listDemoResponses(tx: TransactionClient) {
  const responses = await tx
    .select()
    .from(demoResponses)
    .orderBy(asc(demoResponses.sortOrder), asc(demoResponses.label));

  const patterns = await tx
    .select()
    .from(demoQuestionPatterns)
    .orderBy(asc(demoQuestionPatterns.createdAt));

  return responses.map((r: DemoResponse) => ({
    ...r,
    patterns: patterns.filter((p: DemoQuestionPattern) => p.responseId === r.id),
  }));
}

export async function createDemoResponse(
  tx: TransactionClient,
  data: {
    category: string;
    label: string;
    answerText: string;
    audioUrl?: string | null;
    sortOrder?: number;
    patterns: string[];
  }
) {
  const [response] = await tx
    .insert(demoResponses)
    .values({
      category: data.category,
      label: data.label,
      answerText: data.answerText,
      audioUrl: data.audioUrl ?? null,
      sortOrder: data.sortOrder ?? 0,
    })
    .returning();

  if (data.patterns.length > 0) {
    await tx.insert(demoQuestionPatterns).values(
      data.patterns.map((pattern, i) => ({
        responseId: response.id,
        pattern,
        isCanonical: i === 0 ? 1 : 0,
      }))
    );
  }

  const patterns = await tx
    .select()
    .from(demoQuestionPatterns)
    .where(eq(demoQuestionPatterns.responseId, response.id));

  return { ...response, patterns };
}

export async function updateDemoResponse(
  tx: TransactionClient,
  id: string,
  data: {
    category?: string;
    label?: string;
    answerText?: string;
    audioUrl?: string | null;
    sortOrder?: number;
    patterns?: string[];
  }
) {
  const { patterns: newPatterns, ...fields } = data;

  const [updated] = await tx
    .update(demoResponses)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(demoResponses.id, id))
    .returning();

  if (!updated) return null;

  if (newPatterns !== undefined) {
    // Replace all patterns
    await tx
      .delete(demoQuestionPatterns)
      .where(eq(demoQuestionPatterns.responseId, id));

    if (newPatterns.length > 0) {
      await tx.insert(demoQuestionPatterns).values(
        newPatterns.map((pattern, i) => ({
          responseId: id,
          pattern,
          isCanonical: i === 0 ? 1 : 0,
        }))
      );
    }
  }

  const patterns = await tx
    .select()
    .from(demoQuestionPatterns)
    .where(eq(demoQuestionPatterns.responseId, id));

  return { ...updated, patterns };
}

export async function deleteDemoResponse(
  tx: TransactionClient,
  id: string
) {
  const [deleted] = await tx
    .delete(demoResponses)
    .where(eq(demoResponses.id, id))
    .returning();

  return deleted ?? null;
}
