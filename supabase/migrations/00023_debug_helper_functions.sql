-- Migration: Debug helper functions to see what they return
-- Created: 2026-01-28

-- Test what get_user_organization_id() returns
SELECT
    'TEST get_user_organization_id()' as test_name,
    auth.uid() as current_user_id,
    public.get_user_organization_id() as function_result,
    u.organization_id as direct_query_result
FROM users u
WHERE u.id = auth.uid();

-- Check if there are any RESTRICTIVE policies blocking
SELECT
    'CHECKING FOR RESTRICTIVE POLICIES' as test_name,
    tablename,
    policyname,
    permissive as type,
    cmd,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'projects'
  AND cmd = 'INSERT'
ORDER BY permissive DESC;

-- Check actual grants on the table
SELECT
    'TABLE GRANTS CHECK' as test_name,
    grantee,
    privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name = 'projects'
  AND grantee = 'authenticated'
ORDER BY privilege_type;
