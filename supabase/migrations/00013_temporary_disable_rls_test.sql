-- Temporary: Disable RLS on projects table to test
-- THIS IS ONLY FOR TESTING - DO NOT USE IN PRODUCTION
-- We'll re-enable it once we figure out the issue

-- Disable RLS temporarily
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;

-- We'll re-enable it in the next migration once we understand the issue
