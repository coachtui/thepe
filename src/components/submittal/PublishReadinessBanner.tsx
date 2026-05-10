'use client'

import { useState } from 'react'
import type { PublishReadinessResult } from '@/lib/chat/submittal-publish-readiness'

interface PublishReadinessBannerProps {
  readiness: PublishReadinessResult
}

interface PublishState {
  publishedAt: string
}

export function PublishReadinessBanner({ readiness }: PublishReadinessBannerProps) {
  const [publishState, setPublishState] = useState<PublishState | null>(null)
  const [showModal, setShowModal] = useState(false)

  const { status, reasons } = readiness

  function handlePublishClick() {
    if (status === 'blocked') return
    if (status === 'needs_review') {
      setShowModal(true)
      return
    }
    confirm()
  }

  function confirm() {
    setPublishState({ publishedAt: new Date().toISOString() })
    setShowModal(false)
  }

  if (publishState) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 flex items-center gap-3">
        <span className="text-sm font-medium text-green-800">Register Published</span>
        <span className="text-xs text-green-700">
          {new Date(publishState.publishedAt).toLocaleString(undefined, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
        <button
          type="button"
          onClick={() => setPublishState(null)}
          className="ml-auto text-xs text-green-700 hover:underline cursor-pointer"
        >
          Unpublish
        </button>
      </div>
    )
  }

  const containerClass =
    status === 'blocked'
      ? 'border-red-200 bg-red-50'
      : status === 'needs_review'
        ? 'border-amber-200 bg-amber-50'
        : 'border-green-200 bg-green-50'

  const titleClass =
    status === 'blocked'
      ? 'text-red-800'
      : status === 'needs_review'
        ? 'text-amber-800'
        : 'text-green-800'

  const reasonClass =
    status === 'blocked' ? 'text-red-700' : 'text-amber-700'

  const title =
    status === 'blocked'
      ? 'Blocked — Cannot Publish'
      : status === 'needs_review'
        ? 'Needs Review Before Publishing'
        : 'Ready to Publish'

  const buttonClass =
    status === 'blocked'
      ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed opacity-60'
      : status === 'needs_review'
        ? 'border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200 cursor-pointer'
        : 'border-green-500 bg-green-600 text-white hover:bg-green-700 cursor-pointer'

  return (
    <>
      <div className={`rounded-md border px-4 py-3 ${containerClass}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${titleClass}`}>{title}</p>
            {reasons.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {reasons.map((r, i) => (
                  <li key={i} className={`text-xs ${reasonClass}`}>
                    · {r}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={handlePublishClick}
            disabled={status === 'blocked'}
            className={`shrink-0 mt-0.5 px-3 py-1.5 text-sm font-medium rounded border transition-colors ${buttonClass}`}
          >
            Publish Register
          </button>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-1">
              Publish With Open Issues?
            </h3>
            <p className="text-sm text-gray-600 mb-3">
              The following issues remain unresolved:
            </p>
            <ul className="mb-4 space-y-1 max-h-40 overflow-y-auto">
              {reasons.map((r, i) => (
                <li key={i} className="text-sm text-amber-700">
                  · {r}
                </li>
              ))}
            </ul>
            <p className="text-sm text-gray-500 mb-5">
              You can still publish, but these should be addressed before distributing the register.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 cursor-pointer"
              >
                Go Back
              </button>
              <button
                type="button"
                onClick={confirm}
                className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 cursor-pointer"
              >
                Publish Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
