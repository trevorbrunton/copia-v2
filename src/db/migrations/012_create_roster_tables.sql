-- 012: Create roster tables for autonomous shift filling
-- RLS enabled — user_id scoped via auth.uid()

CREATE TABLE IF NOT EXISTS roster_tasks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  visit_id INTEGER NOT NULL,
  client_id INTEGER,
  status TEXT NOT NULL DEFAULT 'detected',
  urgency TEXT NOT NULL DEFAULT 'planned',
  version INTEGER NOT NULL DEFAULT 1,

  match_result JSONB,
  llm_recommendation JSONB,
  contacts JSONB NOT NULL DEFAULT '[]',
  current_contact_index INTEGER NOT NULL DEFAULT 0,
  cascade_strategy TEXT NOT NULL DEFAULT 'sequential',

  assigned_employee_id INTEGER,
  escalated_to UUID REFERENCES users(id),
  escalation_reason TEXT,

  source_event_id TEXT,

  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  scoring_completed_at TIMESTAMPTZ,
  first_contact_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  time_to_fill_ms INTEGER,

  created_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS roster_audit_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES roster_tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  reasoning TEXT
);

CREATE TABLE IF NOT EXISTS roster_daily_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  date DATE NOT NULL,
  tasks_created INTEGER NOT NULL DEFAULT 0,
  tasks_filled_autonomous INTEGER NOT NULL DEFAULT 0,
  tasks_escalated INTEGER NOT NULL DEFAULT 0,
  avg_time_to_fill_ms INTEGER,
  first_contact_acceptance_rate NUMERIC(5,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

-- RLS
ALTER TABLE roster_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY roster_tasks_isolation ON roster_tasks FOR ALL USING (user_id = auth.uid());
CREATE POLICY roster_audit_isolation ON roster_audit_log FOR ALL USING (user_id = auth.uid());
CREATE POLICY roster_metrics_isolation ON roster_daily_metrics FOR ALL USING (user_id = auth.uid());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_roster_tasks_user_status ON roster_tasks (user_id, status);
CREATE INDEX IF NOT EXISTS idx_roster_tasks_visit_id ON roster_tasks (visit_id);
CREATE INDEX IF NOT EXISTS idx_roster_tasks_source_event ON roster_tasks (source_event_id);
CREATE INDEX IF NOT EXISTS idx_roster_audit_task_id ON roster_audit_log (task_id);
CREATE INDEX IF NOT EXISTS idx_roster_audit_user_id ON roster_audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_roster_metrics_user_date ON roster_daily_metrics (user_id, date);
