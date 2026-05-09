'use client'

import { useEffect } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'

interface SourceDetailDrawerProps {
  item: SubmittalRegisterItem | null
  onClose: () => void
}

export function SourceDetailDrawer({ item, onClose }: SourceDetailDrawerProps) {
  useEffect(() => {
    if (!item) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [item, onClose])

  if (!item) return null

  const heading = [item.specSection, item.sectionTitle].filter(Boolean).join(' · ')
  const docName = item.sourceReference?.documentName
  const pageNum = item.sourceReference?.pageNumber ?? item.sourcePage
  const excerpt = item.sourceExcerpt ?? item.excerpt

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-y-0 right-0 w-full max-w-[480px] bg-white shadow-xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 truncate">
            {heading || item.submittalItem}
          </h2>
          <button
            onClick={onClose}
            className="ml-4 text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {(docName || pageNum != null) && (
            <section>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Source location
              </p>
              <p className="text-sm text-gray-700">
                {[docName, pageNum != null ? `p.${pageNum}` : null].filter(Boolean).join(' · ')}
              </p>
            </section>
          )}
          {excerpt && (
            <section>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Spec excerpt
              </p>
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 border border-gray-200 rounded p-3 leading-relaxed">
                {excerpt}
              </pre>
            </section>
          )}
          {(item.sdCode || item.approvalAuthority || (item.blockingRisk && item.blockingRisk !== 'none')) && (
            <section>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Submittal details
              </p>
              <dl className="space-y-1">
                {item.sdCode && (
                  <div className="flex gap-3 text-sm">
                    <dt className="text-gray-500 w-36 shrink-0">SD code</dt>
                    <dd className="text-gray-900">{item.sdCode}</dd>
                  </div>
                )}
                {item.approvalAuthority && (
                  <div className="flex gap-3 text-sm">
                    <dt className="text-gray-500 w-36 shrink-0">Approval authority</dt>
                    <dd className="text-gray-900">{item.approvalAuthority}</dd>
                  </div>
                )}
                {item.blockingRisk && item.blockingRisk !== 'none' && (
                  <div className="flex gap-3 text-sm">
                    <dt className="text-gray-500 w-36 shrink-0">Blocking risk</dt>
                    <dd className="text-gray-900 capitalize">{item.blockingRisk}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}
          {item.notes && (
            <section>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                Notes
              </p>
              <p className="text-sm text-gray-700">{item.notes}</p>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
