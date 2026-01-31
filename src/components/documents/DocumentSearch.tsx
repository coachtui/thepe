'use client'

import { useState } from 'react'

interface SearchResult {
  chunk_id: string
  document_id: string
  chunk_index: number
  content: string
  page_number: number | null
  similarity: number
  document_filename: string
  project_id: string
}

interface DocumentSearchProps {
  projectId: string
}

export function DocumentSearch({ projectId }: DocumentSearchProps) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!query.trim()) {
      setError('Please enter a search query')
      return
    }

    setSearching(true)
    setError(null)
    setResults([])

    try {
      // Search for similar documents (embedding generated server-side)
      const response = await fetch('/api/documents/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query.trim(),
          projectId,
          limit: 10,
          similarityThreshold: 0.5,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Search failed')
      }

      const data = await response.json()
      setResults(data.results || [])
    } catch (err) {
      console.error('Search error:', err)
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  const highlightText = (text: string, maxLength: number = 300) => {
    if (text.length <= maxLength) return text
    return text.substring(0, maxLength) + '...'
  }

  const formatSimilarity = (similarity: number) => {
    return `${(similarity * 100).toFixed(1)}%`
  }

  return (
    <div className="space-y-4">
      {/* Search Form */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across all documents..."
          className="flex-1 px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          disabled={searching}
        />
        <button
          type="submit"
          disabled={searching || !query.trim()}
          className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {searching ? (
            <span className="flex items-center space-x-2">
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
              <span>Searching...</span>
            </span>
          ) : (
            'Search'
          )}
        </button>
      </form>

      {/* Error Message */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Search Results */}
      {results.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-medium text-gray-900">
            {results.length} {results.length === 1 ? 'result' : 'results'} found
          </h3>

          <div className="space-y-3">
            {results.map((result, index) => (
              <div
                key={result.chunk_id}
                className="p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <h4 className="text-sm font-medium text-gray-900">
                      {result.document_filename}
                    </h4>
                    <div className="flex items-center space-x-3 mt-1 text-xs text-gray-500">
                      {result.page_number && (
                        <span>Page {result.page_number}</span>
                      )}
                      <span>•</span>
                      <span>Chunk {result.chunk_index + 1}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                      {formatSimilarity(result.similarity)} match
                    </span>
                  </div>
                </div>

                <p className="text-sm text-gray-700 leading-relaxed">
                  {highlightText(result.content)}
                </p>

                {/* View Document Button */}
                <button
                  onClick={() => {
                    // TODO: Navigate to document viewer with highlighted chunk
                    window.location.href = `/projects/${projectId}`
                  }}
                  className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  View in document →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* No Results */}
      {!searching && results.length === 0 && query && !error && (
        <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <p className="text-gray-500">
            No results found for "{query}". Try a different search term.
          </p>
        </div>
      )}

      {/* Empty State */}
      {!searching && !query && results.length === 0 && (
        <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
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
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">
            Search your documents
          </h3>
          <p className="mt-1 text-sm text-gray-500">
            Enter a query to find relevant content across all documents.
          </p>
        </div>
      )}
    </div>
  )
}
