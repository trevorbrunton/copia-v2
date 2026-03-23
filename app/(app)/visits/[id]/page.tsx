"use client";

import { use } from "react";
import { useBreadcrumbLabel } from "@/components/breadcrumb-context";
import { VisitDetailCard } from "@/components/visit/visit-detail-card";
import { RecommendationPanel } from "@/components/recommendation/recommendation-panel";
import { MatchResults } from "@/components/match/match-results";

export default function VisitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const visitId = Number(id);
  const isValid = Number.isInteger(visitId) && visitId > 0;

  useBreadcrumbLabel(isValid ? `Visit #${visitId}` : "Invalid Visit");

  if (!isValid) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Invalid Visit</h1>
        <p className="text-muted-foreground">Visit ID must be a positive integer.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Visit #{visitId}</h1>
        <p className="text-muted-foreground mt-1">
          Visit details and employee matching.
        </p>
      </div>

      <VisitDetailCard visitId={visitId} />
      <RecommendationPanel visitId={visitId} />
      <MatchResults visitId={visitId} />
    </div>
  );
}
