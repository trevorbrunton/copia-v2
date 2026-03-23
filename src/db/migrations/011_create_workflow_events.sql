-- 011: Create workflow_events table for webhook event processing
-- No RLS — system events (M2M), not user data

CREATE TABLE IF NOT EXISTS workflow_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  trace_id TEXT,
  result JSONB,
  error TEXT,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_event_type ON workflow_events (event_type);
CREATE INDEX IF NOT EXISTS idx_workflow_events_status ON workflow_events (status);
CREATE INDEX IF NOT EXISTS idx_workflow_events_created_at ON workflow_events (created_at DESC);
