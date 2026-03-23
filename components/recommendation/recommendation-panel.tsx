"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  Bot,
  CheckCircle,
  ShieldAlert,
  User,
  Zap,
} from "lucide-react";
import { useRecommendation } from "@/src/hooks/use-recommendation";
import type { PresetName } from "@/src/services/scoring";
import type { LLMRecommendation } from "@/src/services/reasoning";

const PRESET_LABELS: Record<string, string> = {
  planned: "Planned (default)",
  urgent: "Urgent",
  high_value_client: "High-Value Client",
  new_client: "New Client",
  efficiency: "Efficiency",
};

const CONFIDENCE_STYLES: Record<string, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  low: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const URGENCY_STYLES: Record<string, string> = {
  immediate: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  before_shift: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  informational: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
};

function EscalationCard({ recommendation }: { recommendation: LLMRecommendation }) {
  const { escalation } = recommendation;

  if (!escalation.should_escalate) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
        <CheckCircle className="h-4 w-4" />
        <span>No escalation needed</span>
      </div>
    );
  }

  return (
    <Card className="border-red-200 dark:border-red-800">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-5 w-5 text-red-500" />
          <span className="font-semibold text-red-700 dark:text-red-400">
            Escalation Recommended
          </span>
          <Badge className={URGENCY_STYLES[escalation.urgency]}>
            {escalation.urgency.replace("_", " ")}
          </Badge>
        </div>
        {escalation.reason && (
          <p className="text-sm text-muted-foreground ml-7">
            {escalation.reason}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function RecommendationDetail({ recommendation }: { recommendation: LLMRecommendation }) {
  const { primary } = recommendation;

  return (
    <div className="space-y-4">
      {/* Primary recommendation */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Bot className="h-4 w-4" />
            AI Recommendation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-muted-foreground" />
              <span className="text-lg font-semibold">
                {primary.employee_id === 0 ? "No suitable candidate" : primary.employee_name}
              </span>
            </div>
            <Badge className={CONFIDENCE_STYLES[primary.confidence]}>
              {primary.confidence} confidence
            </Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            {primary.explanation}
          </p>

          {/* Escalation status */}
          <EscalationCard recommendation={recommendation} />
        </CardContent>
      </Card>

      {/* Factors & trade-offs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {recommendation.factors_considered.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Factors Considered
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {recommendation.factors_considered.map((f, i) => (
                  <li key={i} className="text-sm flex items-center gap-2">
                    <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {recommendation.trade_offs.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Trade-offs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {recommendation.trade_offs.map((t, i) => (
                  <li key={i} className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                    {t}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Token usage (small footer) */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>Model: {recommendation.model}</span>
        <span>Tokens: {recommendation.usage.inputTokens} in / {recommendation.usage.outputTokens} out</span>
      </div>
    </div>
  );
}

export function RecommendationPanel({ visitId }: { visitId: number }) {
  const [preset, setPreset] = useState<PresetName>("planned");
  const { data, isLoading, error } = useRecommendation(visitId, { preset });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Zap className="h-5 w-5" />
          AI Recommendation
        </h2>
        <Select value={preset} onValueChange={(v) => setPreset(v as PresetName)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PRESET_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <div className="grid grid-cols-2 gap-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-4">
            <p className="text-destructive">
              Failed to get recommendation. {error instanceof Error ? error.message : "Please try again."}
            </p>
          </CardContent>
        </Card>
      )}

      {data && <RecommendationDetail recommendation={data.recommendation} />}
    </div>
  );
}
