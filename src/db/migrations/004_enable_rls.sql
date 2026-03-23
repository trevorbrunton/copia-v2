-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;

-- Users: can read/write own row
CREATE POLICY users_tenant_isolation ON users
  USING (id::text = current_setting('app.tenant_id', true));

-- Users: bootstrap policy for cognito_id lookup (before tenant is set)
CREATE POLICY users_cognito_lookup ON users
  FOR SELECT
  USING (true);

-- Projects: tenant isolation
CREATE POLICY projects_tenant_isolation ON projects
  USING (user_id::text = current_setting('app.tenant_id', true));

-- Chat conversations: tenant isolation
CREATE POLICY chat_conversations_tenant_isolation ON chat_conversations
  USING (user_id::text = current_setting('app.tenant_id', true));

-- Chat messages: tenant isolation
CREATE POLICY chat_messages_tenant_isolation ON chat_messages
  USING (user_id::text = current_setting('app.tenant_id', true));
