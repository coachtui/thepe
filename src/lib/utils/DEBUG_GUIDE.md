# Debug Logging Guide

## Overview

The Construction Copilot uses a structured debug logging system to control verbose output in development while keeping production logs clean and focused on critical events.

## Quick Start

### 1. Enable Debug Logs

Add to your `.env.local`:

```bash
# Enable all debug logs
DEBUG=*

# Enable specific modules
DEBUG=vision,query

# Disable all debug logs (production default)
DEBUG=
```

### 2. Use in Your Code

```typescript
import { debug, logProduction } from '@/lib/utils/debug';

// Development-only logs (controlled by DEBUG env var)
debug.vision('Processing page 5...');
debug.query('Running fuzzy search for "12-inch valve"');
debug.chat('User message received');

// Production-safe logs (always shown)
logProduction.error('Vision API', error, { documentId: 'abc123' });
logProduction.info('Document Upload', 'Upload complete', { fileSize: 1024000 });
logProduction.cost('Vision Processing', 0.0042, { sheets: 5 });
logProduction.metric('Query Performance', 'latency_ms', 245);
```

## Available Debug Modules

| Module | Purpose | Example Usage |
|--------|---------|---------------|
| `vision` | Vision API calls, image processing | `debug.vision('Analyzing page 3...')` |
| `query` | Search queries, fuzzy matching | `debug.query('Found 5 matches')` |
| `chat` | Chat routing, context building | `debug.chat('Building context...')` |
| `processing` | Document processing pipeline | `debug.processing('Chunking document')` |
| `extraction` | Data extraction from vision results | `debug.extraction('Found 15 quantities')` |
| `database` | Database operations | `debug.database('Inserting 10 rows')` |
| `cost` | Cost calculations | `debug.cost('Estimated $0.05')` |
| `api` | API route handling | `debug.api('POST /api/documents')` |

## Production Logging

These functions **always log** regardless of DEBUG setting - use for critical events:

```typescript
// Always log errors
logProduction.error(
  'Context Name',
  error,
  { additionalMetadata: 'value' }
);

// Always log important info
logProduction.info(
  'Operation Name',
  'Success message',
  { key: 'value' }
);

// Always log costs (important for budget tracking)
logProduction.cost(
  'Vision Processing',
  0.0042,
  { documentId: 'doc123', sheets: 5 }
);

// Always log metrics (important for monitoring)
logProduction.metric(
  'API Performance',
  'latency_ms',
  245,
  { endpoint: '/api/chat' }
);
```

## Migration Guide

### Before (console.log everywhere)

```typescript
console.log('[Vision Processor] Processing page 5...');
console.log('[Vision Processor] Image size: 2048x1024');
console.log('[Vision Processor] Found 10 quantities');
console.error('[Vision Processor] Error:', error);
```

### After (structured logging)

```typescript
import { debug, logProduction } from '@/lib/utils/debug';

debug.vision('Processing page 5...');
debug.vision(`Image size: 2048x1024`);
debug.vision('Found 10 quantities');
logProduction.error('Vision Processor', error, { pageNumber: 5 });
```

## Best Practices

### ✅ DO

- Use `debug.*()` for verbose development logging
- Use `logProduction.*()` for errors, costs, and critical metrics
- Keep log messages concise and actionable
- Include relevant metadata in production logs
- Use appropriate module names for debug logs

### ❌ DON'T

- Use `console.log()` directly (bypasses debug control)
- Log sensitive data (API keys, user passwords)
- Log in tight loops (use sampling or aggregation)
- Use debug logs for critical error reporting
- Mix debug and production logging for the same event

## Examples by Use Case

### Vision Processing

```typescript
// Development logging
debug.vision(`Analyzing page ${pageNumber}...`);
debug.vision(`Model: ${model}, estimated cost: $${cost}`);

// Production logging
logProduction.cost(
  `Vision Page ${pageNumber}`,
  actualCost,
  { model, tokenCount }
);

// Errors (always log)
logProduction.error('Vision Analysis', error, {
  pageNumber,
  documentId
});
```

### Query Processing

```typescript
// Development logging
debug.query(`Searching for: "${searchTerm}"`);
debug.query(`Found ${results.length} matches`);
debug.query(`Fuzzy similarity: ${similarity.toFixed(2)}`);

// Production metrics
logProduction.metric(
  'Query Performance',
  'result_count',
  results.length,
  { queryType: 'count' }
);
```

### Cost Tracking

```typescript
// Always log costs for budget tracking
logProduction.cost(
  'Vision Processing',
  totalCost,
  {
    documentId,
    sheetsProcessed,
    model: 'haiku-4.5'
  }
);

// Development cost details
debug.cost(`Input tokens: ${inputTokens}`);
debug.cost(`Output tokens: ${outputTokens}`);
```

## Environment-Specific Behavior

| Environment | DEBUG Setting | Behavior |
|-------------|---------------|----------|
| Development | `DEBUG=*` | All debug logs shown |
| Development | `DEBUG=vision,query` | Only vision and query logs shown |
| Production | `DEBUG=` (empty) | No debug logs, only production logs |
| Production | Not set | No debug logs, only production logs |

## Performance Impact

- **Debug logs**: Zero overhead when disabled (controlled by env var check)
- **Production logs**: Minimal overhead (always active for critical events)
- String interpolation is only executed when logging is enabled

## Troubleshooting

### "I don't see any logs"

1. Check `.env.local` has `DEBUG=*` or specific modules
2. Restart your dev server after changing `.env.local`
3. Verify you're using `debug.*()` not `console.log()`

### "Too many logs in production"

1. Ensure `DEBUG=` is empty or not set in production `.env`
2. Move verbose logs from `logProduction.*()` to `debug.*()`
3. Only use `logProduction.*()` for errors, costs, and critical metrics

### "Need logs for specific feature"

Enable just that module:
```bash
DEBUG=vision  # Only vision logs
DEBUG=vision,query  # Vision and query logs
```

## Future Enhancements

- [ ] Log levels (debug, info, warn, error)
- [ ] Structured JSON logging for production
- [ ] Log aggregation to external service (DataDog, Sentry)
- [ ] Performance profiling integration
- [ ] Automatic PII redaction
