'use client'

import { useState } from 'react'
import { deleteDocument, getDocumentSignedUrl } from '@/lib/db/queries/documents'
import { createClient } from '@/lib/db/supabase/client'
import type { Database } from '@/lib/db/supabase/types'

type Document = Database['public']['Tables']['documents']['Row']

interface DocumentListProps {
  documents: Document[]
  projectId: string
  onDelete?: () => void
}

export function DocumentList({ documents, projectId, onDelete }: DocumentListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const handleDelete = async (documentId: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
      return
    }

    setDeletingId(documentId)
    try {
      const supabase = createClient()
      await deleteDocument(supabase, documentId)
      onDelete?.()
    } catch (error) {
      console.error('Error deleting document:', error)
      alert('Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDownload = async (document: Document) => {
    setDownloadingId(document.id)
    try {
      const supabase = createClient()
      // Get signed URL for secure download
      const signedUrl = await getDocumentSignedUrl(supabase, document.file_path)

      // Open in new tab or trigger download
      const link = window.document.createElement('a')
      link.href = signedUrl
      link.download = document.filename
      link.target = '_blank'
      window.document.body.appendChild(link)
      link.click()
      window.document.body.removeChild(link)
    } catch (error) {
      console.error('Error downloading document:', error)
      alert('Failed to download document')
    } finally {
      setDownloadingId(null)
    }
  }

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return 'Unknown size'
    const mb = bytes / (1024 * 1024)
    if (mb < 1) {
      return `${(bytes / 1024).toFixed(1)} KB`
    }
    return `${mb.toFixed(2)} MB`
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getStatusBadge = (status: string | null) => {
    if (!status) return null

    const styles = {
      pending: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    }

    return (
      <span
        className={`px-2 py-1 text-xs font-medium rounded-full ${
          styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'
        }`}
      >
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  const getVisionStatusBadge = (
    visionStatus: string | null,
    quantitiesExtracted?: number | null,
    sheetsProcessed?: number | null,
    pageCount?: number | null,
    costUsd?: number | null
  ) => {
    if (!visionStatus || visionStatus === 'pending') return null

    // Build dynamic label based on status
    let label = '';
    let tooltipText = '';

    if (visionStatus === 'processing') {
      if (sheetsProcessed && pageCount) {
        label = `Vision: ${sheetsProcessed}/${pageCount} sheets`;
        tooltipText = `Processing document with Claude Vision API (${sheetsProcessed} of ${pageCount} sheets completed)`;
      } else {
        label = 'Vision processing...';
        tooltipText = 'Processing document with Claude Vision API';
      }
    } else if (visionStatus === 'completed') {
      label = `Vision: ${quantitiesExtracted || 0} items`;
      if (costUsd && costUsd > 0) {
        label += ` ($${costUsd.toFixed(3)})`;
        tooltipText = `Extracted ${quantitiesExtracted || 0} quantities from ${sheetsProcessed || 0} sheets. Cost: $${costUsd.toFixed(4)}`;
      } else {
        tooltipText = `Extracted ${quantitiesExtracted || 0} quantities from ${sheetsProcessed || 0} sheets`;
      }
    } else if (visionStatus === 'failed') {
      label = 'Vision failed';
      tooltipText = 'Vision processing encountered an error. Text search still works.';
    } else if (visionStatus === 'skipped') {
      label = 'Skipped';
      tooltipText = 'Vision processing was skipped for this document';
    }

    const styles = {
      processing: { bg: 'bg-purple-100', text: 'text-purple-800', icon: '🔄' },
      completed: { bg: 'bg-emerald-100', text: 'text-emerald-800', icon: '👁️' },
      failed: { bg: 'bg-orange-100', text: 'text-orange-800', icon: '⚠️' },
      skipped: { bg: 'bg-gray-100', text: 'text-gray-600', icon: '' },
    }

    const config = styles[visionStatus as keyof typeof styles]
    if (!config) return null

    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full ${config.bg} ${config.text}`}
        title={tooltipText}
      >
        {config.icon && <span>{config.icon}</span>}
        {label}
      </span>
    )
  }

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) {
      return (
        <svg className="h-8 w-8 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 18h12V6h-4V2H4v16zm-2 1V0h10l4 4v16H2z" />
        </svg>
      )
    }
    if (fileType.includes('word') || fileType.includes('document')) {
      return (
        <svg className="h-8 w-8 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 18h12V6h-4V2H4v16zm-2 1V0h10l4 4v16H2z" />
        </svg>
      )
    }
    if (fileType.includes('sheet') || fileType.includes('excel')) {
      return (
        <svg className="h-8 w-8 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 18h12V6h-4V2H4v16zm-2 1V0h10l4 4v16H2z" />
        </svg>
      )
    }
    if (fileType.includes('image')) {
      return (
        <svg className="h-8 w-8 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
          <path d="M4 3h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2z" />
        </svg>
      )
    }
    return (
      <svg className="h-8 w-8 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
        <path d="M4 18h12V6h-4V2H4v16zm-2 1V0h10l4 4v16H2z" />
      </svg>
    )
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-gray-900">No documents</h3>
        <p className="mt-1 text-sm text-gray-500">Get started by uploading a document.</p>
      </div>
    )
  }

  return (
    <div className="bg-white shadow-sm rounded-lg overflow-hidden">
      <ul className="divide-y divide-gray-200">
        {documents.map((document) => (
          <li key={document.id} className="p-4 hover:bg-gray-50 transition-colors">
            <div className="flex items-start space-x-4">
              {/* File Icon */}
              <div className="flex-shrink-0">{getFileIcon(document.file_type)}</div>

              {/* Document Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-gray-900 truncate">
                      {document.filename}
                    </h4>
                    <div className="mt-1 flex items-center space-x-3 text-xs text-gray-500">
                      <span>{formatFileSize(document.file_size_bytes)}</span>
                      <span>•</span>
                      <span>{formatDate(document.created_at)}</span>
                      {document.page_count && (
                        <>
                          <span>•</span>
                          <span>{document.page_count} pages</span>
                        </>
                      )}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      {getStatusBadge(document.processing_status)}
                      {getVisionStatusBadge(
                        document.vision_status,
                        document.vision_quantities_extracted,
                        document.vision_sheets_processed,
                        document.page_count,
                        document.vision_cost_usd
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={() => handleDownload(document)}
                      disabled={downloadingId === document.id}
                      className="p-2 text-gray-400 hover:text-blue-600 transition-colors disabled:opacity-50"
                      title="Download"
                    >
                      {downloadingId === document.id ? (
                        <svg
                          className="animate-spin h-5 w-5"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="h-5 w-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                          />
                        </svg>
                      )}
                    </button>

                    <button
                      onClick={() => handleDelete(document.id, document.filename)}
                      disabled={deletingId === document.id}
                      className="p-2 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                      title="Delete"
                    >
                      {deletingId === document.id ? (
                        <svg
                          className="animate-spin h-5 w-5"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                      ) : (
                        <svg
                          className="h-5 w-5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
