-- 007: Defense in Depth foundation
-- Rename RLS variable from app.tenant_id to app.current_tenant_id
-- Add current_tenant_id() helper function for RLS policies

-- 1. Helper function for RLS (single-line to work with migration runner)
CREATE OR REPLACE FUNCTION current_tenant_id() RETURNS text LANGUAGE sql STABLE AS 'SELECT NULLIF(current_setting(''app.current_tenant_id'', true), '''')';

-- 2. Drop old RLS policies (using app.tenant_id)
DROP POLICY IF EXISTS users_tenant_isolation ON users;
DROP POLICY IF EXISTS projects_tenant_isolation ON projects;
DROP POLICY IF EXISTS chat_conversations_tenant_isolation ON chat_conversations;
DROP POLICY IF EXISTS chat_messages_tenant_isolation ON chat_messages;
DROP POLICY IF EXISTS user_status_history_tenant_isolation ON user_status_history;
DROP POLICY IF EXISTS user_devices_tenant_isolation ON user_devices;
DROP POLICY IF EXISTS user_sessions_tenant_isolation ON user_sessions;
DROP POLICY IF EXISTS meetings_tenant_policy ON meetings;

-- 3. Create new policies using current_tenant_id() function
CREATE POLICY users_tenant_isolation ON users
  FOR ALL USING (id::text = current_tenant_id());

CREATE POLICY projects_tenant_isolation ON projects
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY chat_conversations_tenant_isolation ON chat_conversations
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY chat_messages_tenant_isolation ON chat_messages
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY user_status_history_tenant_isolation ON user_status_history
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY user_devices_tenant_isolation ON user_devices
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY user_sessions_tenant_isolation ON user_sessions
  FOR ALL USING (user_id::text = current_tenant_id());

CREATE POLICY meetings_tenant_isolation ON meetings
  FOR ALL USING (user_id::text = current_tenant_id())
  WITH CHECK (user_id::text = current_tenant_id());

-- 4. Bootstrap policy (users_cognito_lookup) is unchanged from migration 004
