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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Trophy, Users } from "lucide-react";
import { useMatch } from "@/src/hooks/use-match";
import type { ScoredCandidate, DimensionScore, PresetName } from "@/src/services/scoring";

const PRESET_LABELS: Record<string, string> = {
  planned: "Planned (default)",
  urgent: "Urgent",
  high_value_client: "High-Value Client",
  new_client: "New Client",
  efficiency: "Efficiency",
};

const DIMENSION_LABELS: Record<string, string> = {
  skills: "Skills",
  relationship: "Relationship",
  proximity: "Proximity",
  workload: "Workload",
  acceptance: "Acceptance",
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  low: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

function ScoreBar({ score, label, dimension }: { score: DimensionScore; label: string; dimension: string }) {
  const pct = Math.round(score.score * 100);
  const barColor =
    pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-500" : "bg-red-500";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p className="text-xs">
          {dimension}: {score.reason} (confidence: {score.confidence})
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function CandidateCard({
  candidate,
  rank,
}: {
  candidate: ScoredCandidate;
  rank: number;
}) {
  const overallPct = Math.round(candidate.overall * 100);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {rank === 1 && <Trophy className="h-4 w-4 text-yellow-500" />}
            <span className="font-semibold">
              #{rank} {candidate.employee_name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold">{overallPct}%</span>
            <Badge className={CONFIDENCE_COLORS[candidate.confidence]}>
              {candidate.confidence}
            </Badge>
          </div>
        </div>

        <div className="space-y-2">
          {(Object.keys(DIMENSION_LABELS) as Array<keyof typeof DIMENSION_LABELS>).map(
            (dim) => (
              <ScoreBar
                key={dim}
                score={candidate.dimensions[dim as keyof typeof candidate.dimensions]}
                label={DIMENSION_LABELS[dim]}
                dimension={dim}
              />
            )
          )}
        </div>

        {candidate.warnings.length > 0 && (
          <div className="space-y-1">
            {candidate.warnings.map((w, i) => (
              <div
                key={i}
                className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400"
              >
                <AlertTriangle className="h-3 w-3" />
                <span>{w}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MatchResults({ visitId }: { visitId: number }) {
  const [preset, setPreset] = useState<PresetName>("planned");
  const { data, isLoading, error } = useMatch(visitId, { preset });

  return (
    <TooltipProvider>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Match Results</h2>
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
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="p-4">
            <p className="text-destructive">
              Failed to load match results. Please try again.
            </p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* Global summary */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <span>
                    {data.eligible_pool_size} eligible of{" "}
                    {data.candidate_pool_size} total
                  </span>
                </div>
                <Badge className={CONFIDENCE_COLORS[data.match_confidence]}>
                  {data.match_confidence} confidence
                </Badge>
              </div>

              {data.data_warnings.length > 0 && (
                <div className="mt-3 space-y-1">
                  {data.data_warnings.map((w, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1 text-xs text-yellow-600 dark:text-yellow-400"
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Candidate list */}
          {data.candidates.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              No eligible candidates found.
            </p>
          ) : (
            <div className="space-y-3">
              {data.candidates.map((candidate, i) => (
                <CandidateCard
                  key={candidate.employee_id}
                  candidate={candidate}
                  rank={i + 1}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
    </TooltipProvider>
  );
}
