'use client'

import { useState, useCallback } from 'react'
import { uploadDocumentFile, createDocument } from '@/lib/db/queries/documents'

interface DocumentUploadProps {
  projectId: string
  onUploadComplete?: () => void
}

export function DocumentUpload({ projectId, onUploadComplete }: DocumentUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<string>('')

  const handleUpload = async (file: File) => {
    if (!file) return

    // Validate file type
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'image/jpeg',
      'image/png',
      'application/dwg', // AutoCAD
      'application/dxf', // AutoCAD DXF
    ]

    if (!allowedTypes.includes(file.type) && !file.name.toLowerCase().endsWith('.dwg')) {
      setError('File type not supported. Please upload PDF, DOCX, XLSX, JPG, PNG, or DWG files.')
      return
    }

    // Validate file size (500MB max)
    const maxSize = 500 * 1024 * 1024 // 500MB in bytes
    if (file.size > maxSize) {
      setError('File too large. Maximum size is 500MB.')
      return
    }

    setUploading(true)
    setError(null)
    setUploadProgress('Uploading file...')

    try {
      // Get Supabase client
      const { createClient } = await import('@/lib/db/supabase/client')
      const supabase = createClient()

      // Get current user ID from Supabase auth
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        throw new Error('User not authenticated')
      }

      // Upload file to Supabase Storage
      const { path } = await uploadDocumentFile(supabase, projectId, file)
      setUploadProgress('Creating document record...')

      // Create document record in database
      const newDocument = await createDocument(supabase, {
        project_id: projectId,
        filename: file.name,
        file_path: path,
        file_type: file.type || 'application/octet-stream',
        file_size_bytes: file.size,
        processing_status: 'pending',
        uploaded_by: user.id,
      })

      setUploadProgress('Upload complete! Starting processing...')

      // Trigger background processing with LlamaParse
      try {
        const processResponse = await fetch('/api/documents/process', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ documentId: newDocument.id }),
        })

        if (processResponse.ok) {
          setUploadProgress('Processing started in background')
        } else {
          console.error('Failed to start processing:', await processResponse.text())
          setUploadProgress('Upload complete (processing queued)')
        }
      } catch (processError) {
        console.error('Failed to trigger processing:', processError)
        setUploadProgress('Upload complete (processing queued)')
      }

      // Reset state
      setTimeout(() => {
        setUploadProgress('')
        setUploading(false)
        onUploadComplete?.()
      }, 1500)
    } catch (err) {
      console.error('Upload error:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
      setUploading(false)
      setUploadProgress('')
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleUpload(file)
    }
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      const file = e.dataTransfer.files[0]
      if (file) {
        handleUpload(file)
      }
    },
    [projectId]
  )

  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-lg p-8 text-center transition-colors
          ${isDragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'}
          ${uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <input
          type="file"
          id="file-upload"
          onChange={handleFileInput}
          disabled={uploading}
          accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.dwg,.dxf"
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />

        <div className="space-y-3">
          {/* Upload Icon */}
          <svg
            className="mx-auto h-12 w-12 text-gray-400"
            stroke="currentColor"
            fill="none"
            viewBox="0 0 48 48"
            aria-hidden="true"
          >
            <path
              d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>

          {/* Upload Text */}
          <div className="text-sm text-gray-600">
            {uploading ? (
              <p className="font-medium text-blue-600">{uploadProgress}</p>
            ) : (
              <>
                <label
                  htmlFor="file-upload"
                  className="font-medium text-blue-600 hover:text-blue-500 cursor-pointer"
                >
                  Upload a file
                </label>
                <span> or drag and drop</span>
              </>
            )}
          </div>

          {/* File Types */}
          <p className="text-xs text-gray-500">
            PDF, DOCX, XLSX, JPG, PNG, DWG up to 500MB
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
