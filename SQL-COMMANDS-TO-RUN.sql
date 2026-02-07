-- ============================================================================
-- RLS FIX - SQL COMMANDS TO RUN IN SUPABASE DASHBOARD
-- ============================================================================
-- Run these commands ONE BY ONE in Supabase SQL Editor
-- After each section, check the output before proceeding
-- ============================================================================

-- STEP 1: Check if RLS is actually enabled on the projects table
-- ============================================================================
SELECT
    tablename,
    rowsecurity as rls_enabled,
    tableowner
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'projects';

-- Expected: rls_enabled = true
-- If false, RLS is disabled and policies don't apply!


-- STEP 2: Check what policies currently exist
-- ============================================================================
SELECT
    policyname,
    permissive as type,
    cmd as operation,
    roles,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'projects'
  AND cmd = 'INSERT'
ORDER BY permissive DESC;

-- Expected: Should see projects_insert_test with WITH CHECK = true
-- If you see RESTRICTIVE policies, those could be blocking


-- STEP 3: Check table grants for authenticated role
-- ============================================================================
SELECT
    grantee,
    privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name = 'projects'
  AND grantee = 'authenticated'
ORDER BY privilege_type;

-- Expected: Should see INSERT grant
-- If missing, policies won't help!


-- STEP 4: Grant permissions (if missing from Step 3)
-- ============================================================================
GRANT INSERT ON public.projects TO authenticated;
GRANT SELECT ON public.projects TO authenticated;
GRANT UPDATE ON public.projects TO authenticated;
GRANT DELETE ON public.projects TO authenticated;

GRANT INSERT ON public.project_members TO authenticated;
GRANT SELECT ON public.project_members TO authenticated;
GRANT DELETE ON public.project_members TO authenticated;

-- Grant sequence usage for auto-generated IDs
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;


-- STEP 5: Drop ALL existing policies (clean slate)
-- ============================================================================
DO $$
DECLARE
    pol RECORD;
BEGIN
    -- Drop all policies on projects table
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'projects'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON projects', pol.policyname);
        RAISE NOTICE 'Dropped policy: %', pol.policyname;
    END LOOP;
END
$$;


-- STEP 6: Create the absolute simplest INSERT policy
-- ============================================================================
CREATE POLICY "allow_authenticated_insert" ON public.projects
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- This is the MOST permissive policy possible
-- If this doesn't work, the issue is grants or RLS being disabled


-- STEP 7: Create SELECT policy so you can see created projects
-- ============================================================================
CREATE POLICY "allow_authenticated_select" ON public.projects
    FOR SELECT
    TO authenticated
    USING (
        id IN (
            SELECT project_id
            FROM public.project_members
            WHERE user_id = auth.uid()
        )
    );


-- STEP 8: Reload PostgREST schema cache
-- ============================================================================
NOTIFY pgrst, 'reload schema';


-- STEP 9: Verify the policies were created
-- ============================================================================
SELECT
    policyname,
    permissive,
    cmd,
    with_check,
    qual as using_clause
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'projects'
ORDER BY cmd, policyname;

-- Expected: Should see allow_authenticated_insert with WITH CHECK = true


-- STEP 10: Check for triggers that might block inserts
-- ============================================================================
SELECT
    trigger_name,
    event_manipulation,
    action_timing,
    action_statement
FROM information_schema.triggers
WHERE event_object_table = 'projects'
  AND event_object_schema = 'public';

-- If you see BEFORE INSERT triggers, they might be blocking


-- ============================================================================
-- AFTER RUNNING THESE COMMANDS
-- ============================================================================
-- Go to: http://localhost:3000/api/test-rls
--
-- IF IT WORKS (success: true):
--   The issue was grants or stale policies
--   Now we can add proper org-based security
--
-- IF IT STILL FAILS:
--   Check the output of Steps 1, 2, 3, and 10
--   Share the results and we'll debug further
-- ============================================================================
