-- Check current INSERT policy on projects
SELECT
    policyname,
    permissive,
    cmd,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'projects'
  AND cmd = 'INSERT';
