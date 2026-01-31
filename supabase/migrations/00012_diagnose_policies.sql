-- Diagnostic: Check current state of RLS and policies
-- Run this to see what's actually in the database

-- Part 1: Check if RLS is enabled on tables
SELECT
    schemaname,
    tablename,
    rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('users', 'organizations', 'projects', 'project_members')
ORDER BY tablename;

-- Part 2: Check what policies currently exist
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users', 'organizations', 'projects', 'project_members')
ORDER BY tablename, policyname;

-- Part 3: Check helper functions exist
SELECT
    proname AS function_name,
    prosecdef AS is_security_definer
FROM pg_proc
WHERE proname IN (
    'get_user_organization_id',
    'get_user_project_ids',
    'user_can_manage_project',
    'user_is_project_owner',
    'project_has_no_members'
)
ORDER BY proname;
