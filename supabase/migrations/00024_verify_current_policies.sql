-- Check exactly what policies exist and their type
SELECT
    schemaname,
    tablename,
    policyname,
    permissive as policy_type, -- 'PERMISSIVE' or 'RESTRICTIVE'
    roles,
    cmd,
    qual as using_clause,
    with_check
FROM pg_policies
WHERE tablename IN ('projects', 'project_members')
ORDER BY tablename, cmd, policyname;
