-- Add user lifecycle columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS purge_after timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';
ALTER TABLE users ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'en';
ALTER TABLE users ADD COLUMN IF NOT EXISTS metadata jsonb;

-- User status history table
CREATE TABLE IF NOT EXISTS user_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason text,
  changed_by uuid REFERENCES users(id),
  ip_address text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_status_history_user_id ON user_status_history(user_id);

-- User devices table
CREATE TABLE IF NOT EXISTS user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_fingerprint text NOT NULL,
  device_name text,
  device_type text,
  os text,
  browser text,
  trusted integer NOT NULL DEFAULT 0,
  last_ip text,
  last_active_at timestamptz,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT uq_user_device_fingerprint UNIQUE (user_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user_id ON user_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_user_devices_fingerprint ON user_devices(device_fingerprint);

-- User sessions table
CREATE TABLE IF NOT EXISTS user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES user_devices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  ip_address text,
  user_agent text,
  started_at timestamptz DEFAULT now(),
  last_active_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  ended_reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_status ON user_sessions(status);
CREATE INDEX IF NOT EXISTS idx_user_sessions_device_id ON user_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_status ON user_sessions(user_id, status);

-- Enable RLS on new tables
ALTER TABLE user_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE user_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions FORCE ROW LEVEL SECURITY;

-- RLS policies: tenant isolation using app.tenant_id
-- Note: user_status_history RLS uses user_id as tenant. When RBAC is added,
-- admin operations will need a bootstrap-style policy (similar to users_cognito_lookup).
CREATE POLICY user_status_history_tenant_isolation ON user_status_history
  USING (user_id::text = current_setting('app.tenant_id', true));

CREATE POLICY user_devices_tenant_isolation ON user_devices
  USING (user_id::text = current_setting('app.tenant_id', true));

CREATE POLICY user_sessions_tenant_isolation ON user_sessions
  USING (user_id::text = current_setting('app.tenant_id', true));
