"use client";

import { QaManagement } from "@/components/config/qa-management";

export default function ConfigPage() {
  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Configuration</h1>
        <p className="text-muted-foreground mt-1">
          Manage demo questions and answers
        </p>
      </div>

      <QaManagement />
    </div>
  );
}
