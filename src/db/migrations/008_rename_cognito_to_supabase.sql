-- 008: Rename cognito_id column to supabase_id
-- The Drizzle schema already references supabase_id. This aligns the DB.
-- All FKs reference users.id (UUID PK), not this column, so they are unaffected.

ALTER TABLE users RENAME COLUMN cognito_id TO supabase_id;

-- Rename the unique index if it exists
ALTER INDEX IF EXISTS users_cognito_id_unique RENAME TO users_supabase_id_unique;

-- Also drop the old bootstrap lookup policy that references cognito_id
DROP POLICY IF EXISTS users_cognito_lookup ON users;
