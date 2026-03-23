-- 009: Switch RLS policies from current_tenant_id() to auth.uid()
-- auth.uid() reads from request.jwt.claims->>'sub' which the UoW sets
-- to the internal users.id (principalId), so all FK comparisons work directly.

-- 1. Drop old policies that use current_tenant_id()
DROP POLICY IF EXISTS users_tenant_isolation ON users;
DROP POLICY IF EXISTS projects_tenant_isolation ON projects;
DROP POLICY IF EXISTS chat_conversations_tenant_isolation ON chat_conversations;
DROP POLICY IF EXISTS chat_messages_tenant_isolation ON chat_messages;
DROP POLICY IF EXISTS user_status_history_tenant_isolation ON user_status_history;
DROP POLICY IF EXISTS user_devices_tenant_isolation ON user_devices;
DROP POLICY IF EXISTS user_sessions_tenant_isolation ON user_sessions;
DROP POLICY IF EXISTS meetings_tenant_isolation ON meetings;

-- 2. Create new policies using auth.uid()
-- Note: auth.uid() returns UUID. user_id columns are UUID. No casting needed.

CREATE POLICY users_tenant_isolation ON users
  FOR ALL USING (id = auth.uid());

CREATE POLICY projects_tenant_isolation ON projects
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY chat_conversations_tenant_isolation ON chat_conversations
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY chat_messages_tenant_isolation ON chat_messages
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY user_status_history_tenant_isolation ON user_status_history
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY user_devices_tenant_isolation ON user_devices
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY user_sessions_tenant_isolation ON user_sessions
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY meetings_tenant_isolation ON meetings
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3. Drop the old current_tenant_id() function (no longer needed)
DROP FUNCTION IF EXISTS current_tenant_id();
