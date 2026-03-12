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

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    visionProcessDocument,
  ],
})
