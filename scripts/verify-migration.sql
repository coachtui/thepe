-- Quick verification script for batch processing migration
-- Run this after applying the migration to verify everything is set up correctly

-- 1. Check tables exist
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('vision_processing_jobs', 'vision_processing_chunks', 'vision_job_events')
ORDER BY table_name;

-- Expected output:
-- vision_job_events        | 5
-- vision_processing_chunks | 18
-- vision_processing_jobs   | 20

-- 2. Check indexes exist
SELECT
  tablename,
  indexname
FROM pg_indexes
WHERE tablename LIKE 'vision_%'
ORDER BY tablename, indexname;

-- Expected: ~10 indexes across the 3 tables

-- 3. Check RLS is enabled
SELECT
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename LIKE 'vision_%';

-- Expected: All should show 't' (true)

-- 4. Check helper functions exist
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name IN ('get_job_progress', 'get_estimated_time_remaining')
  AND routine_schema = 'public';

-- Expected: 2 functions

-- 5. Test inserting a dummy job (will be cleaned up)
DO $$
DECLARE
  test_project_id UUID;
  test_document_id UUID;
  test_job_id UUID;
BEGIN
  -- Get first project (or skip if no projects exist)
  SELECT id INTO test_project_id FROM projects LIMIT 1;

  IF test_project_id IS NOT NULL THEN
    -- Get first document in that project
    SELECT id INTO test_document_id FROM documents WHERE project_id = test_project_id LIMIT 1;

    IF test_document_id IS NOT NULL THEN
      -- Insert test job
      INSERT INTO vision_processing_jobs (
        job_key,
        project_id,
        document_id,
        total_pages,
        pages_per_chunk,
        total_chunks
      ) VALUES (
        'test-job-' || gen_random_uuid()::text,
        test_project_id,
        test_document_id,
        100,
        50,
        2
      ) RETURNING id INTO test_job_id;

      -- Insert test chunk
      INSERT INTO vision_processing_chunks (
        job_id,
        chunk_index,
        page_start,
        page_end,
        page_count
      ) VALUES (
        test_job_id,
        0,
        1,
        50,
        50
      );

      -- Test helper functions
      RAISE NOTICE 'Job progress: %', get_job_progress(test_job_id);
      RAISE NOTICE 'Time remaining: %', get_estimated_time_remaining(test_job_id);

      -- Clean up test data
      DELETE FROM vision_processing_jobs WHERE id = test_job_id;

      RAISE NOTICE 'Migration verification PASSED ✓';
    ELSE
      RAISE NOTICE 'No documents found - skipping insert test';
    END IF;
  ELSE
    RAISE NOTICE 'No projects found - skipping insert test';
  END IF;
END $$;
