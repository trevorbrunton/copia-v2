"use client";

import type { ScoredCandidate } from "@/src/services/scoring/types";
import { ScoreBar } from "./score-bar";
import { Button } from "@/components/ui/button";
import { User } from "lucide-react";

export function CandidateList({
  candidates,
  onAssign,
  isAssigning,
}: {
  candidates: ScoredCandidate[];
  onAssign: (employeeId: number) => void;
  isAssigning: boolean;
}) {
  if (candidates.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-2">
        No scored candidates available
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {candidates.slice(0, 10).map((c, i) => (
        <div
          key={c.employee_id}
          className="flex items-center gap-3 py-2 border-b last:border-0"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="text-xs text-muted-foreground w-4">#{i + 1}</span>
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium truncate">{c.employee_name}</span>
          </div>
          <div className="w-32">
            <ScoreBar score={c.overall} />
          </div>
          <div className="text-xs text-muted-foreground w-12 text-center">
            {c.confidence}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAssign(c.employee_id)}
            disabled={isAssigning}
          >
            Assign
          </Button>
        </div>
      ))}
    </div>
  );
}
