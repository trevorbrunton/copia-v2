export interface DataValidationResult {
  valid: boolean;
  warnings: string[];
  blockers: string[];
}

export interface ValidatableVisit {
  id: number;
  client_id?: number | null;
  start_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface ValidatableEmployee {
  id: number;
  status?: string;
}

export function validateMatchInputs(
  visit: ValidatableVisit | null,
  client: { id: number } | null,
  employees: ValidatableEmployee[]
): DataValidationResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!visit) {
    blockers.push("Visit not found");
    return { valid: false, blockers, warnings };
  }

  if (!visit.client_id && !client) {
    blockers.push("No client associated with visit");
  }

  if (employees.length === 0) {
    blockers.push("No eligible employees found");
  }

  if (visit.start_at) {
    const startTime = new Date(visit.start_at).getTime();
    if (startTime < Date.now()) {
      warnings.push("Visit start time is in the past");
    }
  } else {
    warnings.push("Visit has no start time");
  }

  if (visit.latitude == null || visit.longitude == null) {
    warnings.push("Visit missing GPS coordinates — distance scoring will be skipped");
  }

  const activeEmployees = employees.filter(
    (e) => !e.status || e.status === "active"
  );
  if (activeEmployees.length < 3) {
    warnings.push(
      `Only ${activeEmployees.length} active employee(s) — limited candidate pool`
    );
  }

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
  };
}
