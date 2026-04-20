/**
 * Inngest API Route
 *
 * This endpoint is called by Inngest to register functions and deliver events.
 * It must be publicly accessible (no auth middleware) — the middleware.ts
 * already exempts /api/inngest from session checks.
 *
 * Inngest signs all requests with INNGEST_SIGNING_KEY for security.
 */

import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { visionProcessDocument } from '@/inngest/functions/vision-process-document'
import { visionStuckRecovery } from '@/inngest/functions/vision-stuck-recovery'

// Allow each step invocation up to 5 minutes — vision processing (PDF render +
// Claude API) for a page-range chunk can take 2-3 minutes on a large document.
// Vercel Pro supports up to 300s; Hobby is capped at 60s.
export const maxDuration = 300

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    visionProcessDocument,
    visionStuckRecovery,
  ],
})
