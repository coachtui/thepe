# Database SQL Error Fix

## Issue
When querying for electrical LF, the system returned:
```
Error calculating length from terminations: {
  code: '42702',
  message: 'column reference "utility_name" is ambiguous'
}
```

## Root Cause
The `calculate_utility_length()` PostgreSQL function in migration `00032` had an ambiguous column reference.

**Problem code** (line 133):
```sql
RETURN QUERY SELECT
    v_begin_point.utility_name,  -- ❌ Ambiguous with RETURNS TABLE column
    v_begin_point.station,
    ...
```

When the function's RETURNS TABLE defines a column named `utility_name`, and you also reference `v_begin_point.utility_name` in the SELECT, PostgreSQL doesn't know which one you mean.

## Solution
Created migration `00037_fix_calculate_utility_length_ambiguity.sql` that:

1. **Explicitly casts** all record fields:
```sql
RETURN QUERY SELECT
    v_begin_point.utility_name::TEXT,  -- ✅ Explicit cast removes ambiguity
    v_begin_point.station::TEXT,
    ...
```

2. **Fully qualifies** table columns in WHERE clauses:
```sql
WHERE utility_termination_points.utility_name ILIKE ...
```

## How to Apply

### Local Development
```bash
npx supabase db reset --local
```

### Production
```bash
npx supabase db push
```

Or manually run the SQL from migration file `00037`.

## Test
After applying, this query should work:
```sql
SELECT * FROM calculate_utility_length(
    'c455e726-b3b4-4f87-97e9-70a89ec17228'::UUID,
    'electrical'
);
```

And in the app:
- "How much LF of electrical do we have?" should now return data
- No more `42702` errors in logs

## Impact
- ✅ Fixes electrical LF queries
- ✅ Fixes all other utility length calculations (water, gas, storm, etc.)
- ✅ No breaking changes - same function signature
- ✅ Backward compatible with existing code

## Files Changed
- `supabase/migrations/00037_fix_calculate_utility_length_ambiguity.sql` - New migration (fix)
- Original issue in: `supabase/migrations/00032_add_utility_termination_points.sql` (line 133)
