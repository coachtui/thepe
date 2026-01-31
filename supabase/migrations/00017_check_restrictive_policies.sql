-- Check if there are any RESTRICTIVE policies blocking inserts
SELECT
    tablename,
    policyname,
    permissive,  -- Should be 'PERMISSIVE' or 'RESTRICTIVE'
    cmd,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'projects'
ORDER BY cmd, permissive, policyname;
