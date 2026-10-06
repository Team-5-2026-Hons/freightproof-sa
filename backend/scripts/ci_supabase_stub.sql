-- Minimal stand-in for the Supabase objects our migrations reference, so CI can apply the
-- whole chain to a plain postgres:17 database. Supabase provides all of these for real;
-- this file must NEVER be run against the Supabase dev database (it would collide with them).
--
-- Only what the migrations touch:
--   0002_tom_supabase_auth_schema  FKs to auth.users(id)
--   0003_tom_rls_policies          auth.uid(), auth.jwt(), policies TO anon/authenticated/service_role
--   later migrations               GRANT/REVOKE on the same three roles (some guarded by pg_roles)

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
    id uuid PRIMARY KEY
);

-- Real Supabase reads these from the request's JWT claims. Signatures match; bodies only
-- need to be valid SQL, because CI never evaluates a policy.
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(auth.jwt() ->> 'sub', '')::uuid $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
END
$$;
