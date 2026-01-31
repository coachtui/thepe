/**
 * LlamaParse integration for document parsing
 * Phase 2: Document Management & RAG
 *
 * Using LlamaCloud REST API directly instead of SDK
 */

const LLAMA_API_KEY = process.env.LLAMA_CLOUD_API_KEY

if (!LLAMA_API_KEY) {
  console.warn('LLAMA_CLOUD_API_KEY not found in environment variables')
}

export interface ParsedDocument {
  text: string
  pageCount: number
  metadata: {
    filename: string
    fileType: string
    parsingTime: number
  }
}

/**
 * Parse a document using LlamaParse
 * Supports PDF, DOCX, and other document formats
 */
export async function parseDocument(
  filePath: string,
  fileName: string
): Promise<ParsedDocument> {
  if (!LLAMA_API_KEY) {
    throw new Error('LLAMA_CLOUD_API_KEY is not configured')
  }

  const startTime = Date.now()

  try {
    // Read file
    const fs = await import('fs')
    const { promisify } = await import('util')
    const readFile = promisify(fs.readFile)

    const fileBuffer = await readFile(filePath)
    const fileBlob = new Blob([fileBuffer])

    // Create form data
    const formData = new FormData()
    formData.append('file', fileBlob, fileName)
    formData.append('language', 'en')
    formData.append('result_type', 'text')  // RAW text extraction only - no markdown formatting
    formData.append('premium_mode', 'true')  // Enable vision-based parsing for better OCR
    // NO parsing_instruction - we want raw text exactly as it appears on the PDF

    // Upload to LlamaCloud
    const uploadResponse = await fetch('https://api.cloud.llamaindex.ai/api/parsing/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LLAMA_API_KEY}`,
      },
      body: formData,
    })

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text()
      throw new Error(`LlamaParse upload failed: ${error}`)
    }

    const { id: jobId } = await uploadResponse.json()

    // Poll for results
    let result = null
    let attempts = 0
    const maxAttempts = 180 // 15 minutes max (increased for large construction docs)

    while (!result && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds

      const statusResponse = await fetch(
        `https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}`,
        {
          headers: {
            'Authorization': `Bearer ${LLAMA_API_KEY}`,
          },
        }
      )

      if (!statusResponse.ok) {
        throw new Error('Failed to check parsing status')
      }

      const status = await statusResponse.json()

      if (status.status === 'SUCCESS') {
        result = status
        break
      } else if (status.status === 'ERROR') {
        throw new Error(`Parsing failed: ${status.error}`)
      }

      attempts++
    }

    if (!result) {
      throw new Error('Parsing timeout - document took too long to process')
    }

    // Extract text from result
    const text = result.markdown || result.text || ''
    const estimatedPageCount = Math.ceil(text.length / 2500)
    const parsingTime = Date.now() - startTime

    return {
      text,
      pageCount: estimatedPageCount,
      metadata: {
        filename: fileName,
        fileType: 'pdf',
        parsingTime,
      },
    }
  } catch (error) {
    console.error('LlamaParse error:', error)
    throw new Error(`Failed to parse document: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Parse document from URL (for Supabase Storage URLs)
 */
export async function parseDocumentFromUrl(
  url: string,
  fileName: string
): Promise<ParsedDocument> {
  if (!LLAMA_API_KEY) {
    throw new Error('LLAMA_CLOUD_API_KEY is not configured')
  }

  const startTime = Date.now()

  try {
    // Download file
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    const fileBlob = new Blob([arrayBuffer])

    // Upload directly to LlamaCloud API
    const formData = new FormData()
    formData.append('file', fileBlob, fileName)
    formData.append('language', 'en')
    formData.append('result_type', 'text')  // RAW text extraction only - no markdown formatting
    formData.append('premium_mode', 'true')  // Enable vision-based parsing for better OCR
    // NO parsing_instruction - we want raw text exactly as it appears on the PDF

    // Upload to LlamaCloud
    const uploadResponse = await fetch('https://api.cloud.llamaindex.ai/api/parsing/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LLAMA_API_KEY}`,
      },
      body: formData,
    })

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text()
      throw new Error(`LlamaParse upload failed: ${error}`)
    }

    const { id: jobId } = await uploadResponse.json()
    console.log('LlamaParse job ID:', jobId)

    // Poll for results using v1 API (matches upload version)
    let result = null
    let attempts = 0
    const maxAttempts = 180 // 15 minutes max (increased for large construction docs)

    while (!result && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)) // Wait 5 seconds

      // Use v1 API to match the upload endpoint
      const statusResponse = await fetch(
        `https://api.cloud.llamaindex.ai/api/parsing/job/${jobId}`,
        {
          headers: {
            'Authorization': `Bearer ${LLAMA_API_KEY}`,
          },
        }
      )

      if (!statusResponse.ok) {
        const errorText = await statusResponse.text()
        console.error('Status check failed:', errorText)
        throw new Error('Failed to check parsing status')
      }

      const status = await statusResponse.json()
      console.log('🔍 Status check:', status.status)

      if (status.status === 'SUCCESS' || status.status === 'COMPLETED') {
        console.log('✅ LlamaParse job completed! Now fetching result...')
        result = status
        break
      } else if (status.status === 'ERROR' || status.status === 'FAILED') {
        throw new Error(`Parsing failed: ${status.error || 'Unknown error'}`)
      }

      attempts++
    }

    if (!result) {
      throw new Error('Parsing timeout - document took too long to process')
    }

    // Fetch the actual parsed content using the result endpoint
    console.log('🔍 Fetching parsed content from result endpoint...')

    const resultResponse = await fetch(
      `https://api.cloud.llamaindex.ai/api/v1/parsing/job/${jobId}/result/text`,
      {
        headers: {
          'Authorization': `Bearer ${LLAMA_API_KEY}`,
        },
      }
    )

    if (!resultResponse.ok) {
      const errorText = await resultResponse.text()
      console.error('❌ Failed to fetch result:', errorText)
      throw new Error(`Failed to fetch parsing result: ${errorText}`)
    }

    // The result endpoint returns the markdown content directly as text
    const text = await resultResponse.text()
    console.log('✅ Successfully fetched parsed content!')
    console.log('🔍 Final extracted text length:', text.length)
    if (text.length > 0) {
      console.log('🔍 First 500 chars:', text.substring(0, 500))
    } else {
      console.log('⚠️ WARNING: No text extracted from document!')
    }

    const estimatedPageCount = Math.ceil(text.length / 2500)
    const parsingTime = Date.now() - startTime

    return {
      text,
      pageCount: estimatedPageCount,
      metadata: {
        filename: fileName,
        fileType: 'pdf',
        parsingTime,
      },
    }
  } catch (error) {
    console.error('Error parsing document from URL:', error)
    throw new Error(`Failed to parse document from URL: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Validate if a file can be parsed by LlamaParse
 */
export function canParse(fileType: string): boolean {
  const supportedTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
    'application/msword', // .doc
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
    'application/vnd.ms-powerpoint', // .ppt
  ]

  return supportedTypes.includes(fileType)
}
