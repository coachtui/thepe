-- Comprehensive RLS Diagnostics
-- Created: 2026-01-28
-- Purpose: Understand current RLS state and auth context

-- 1. Check all policies on projects table
SELECT
    'PROJECTS POLICIES' as section,
    policyname,
    permissive as policy_type,
    cmd as operation,
    CASE
        WHEN qual IS NOT NULL THEN 'USING: ' || qual
        ELSE 'No USING clause'
    END as using_clause,
    CASE
        WHEN with_check IS NOT NULL THEN 'WITH CHECK: ' || with_check
        ELSE 'No WITH CHECK clause'
    END as with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'projects'
ORDER BY cmd, policyname;

-- 2. Check helper functions
SELECT
    'HELPER FUNCTIONS' as section,
    proname as function_name,
    prosecdef as is_security_definer,
    provolatile as volatility,
    pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND (proname LIKE '%project%' OR proname LIKE '%organization%' OR proname LIKE '%user%')
  AND proname NOT LIKE 'pg_%';

-- 3. Check table ownership and RLS status
SELECT
    'TABLE STATUS' as section,
    tablename,
    tableowner,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('projects', 'project_members', 'organizations', 'users')
ORDER BY tablename;

-- 4. Check roles and their permissions
SELECT
    'ROLES' as section,
    rolname,
    rolsuper as is_superuser,
    rolinherit as inherits_privileges,
    rolcreaterole as can_create_roles,
    rolcreatedb as can_create_db
FROM pg_roles
WHERE rolname IN ('postgres', 'authenticator', 'authenticated', 'anon', 'service_role')
ORDER BY rolname;

-- 5. Check grants on projects table
SELECT
    'TABLE GRANTS' as section,
    grantee,
    privilege_type,
    is_grantable
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name = 'projects'
ORDER BY grantee, privilege_type;

-- 6. Create a test function to check auth context
CREATE OR REPLACE FUNCTION public.test_auth_context()
RETURNS json
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT json_build_object(
        'auth_uid', auth.uid(),
        'auth_role', auth.role(),
        'current_user', current_user,
        'session_user', session_user,
        'current_setting_role', current_setting('role', true)
    );
$$;

GRANT EXECUTE ON FUNCTION public.test_auth_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.test_auth_context() TO anon;

-- Run the auth context test
SELECT 'AUTH CONTEXT TEST' as section, public.test_auth_context() as context;
