'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface ChatInterfaceProps {
  projectId: string
}

export function ChatInterface({ projectId }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Flag Issue modal state
  const [flagModal, setFlagModal] = useState<{
    messageId: string
    messageContent: string
  } | null>(null)
  const [flagForm, setFlagForm] = useState<{
    expected_value: string
    submitted_by_role: string
    sheet_number: string
    notes: string
  }>({
    expected_value: '',
    submitted_by_role: 'engineer',
    sheet_number: '',
    notes: '',
  })
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [flagSuccess, setFlagSuccess] = useState(false)
  const [flagError, setFlagError] = useState<string | null>(null)

  useEffect(() => {
    if (!flagModal) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFlagModal(null)
        setFlagError(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [flagModal])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)
    setError(null)

    try {
      // Send all previous messages for conversation context
      const conversationHistory = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }))

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: conversationHistory,
          projectId,
        }),
      })

      if (!response.ok) {
        throw new Error('Chat request failed')
      }

      if (!response.body) {
        throw new Error('No response body')
      }

      // Read the streaming response
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let assistantMessage = ''

      const assistantMessageId = (Date.now() + 1).toString()

      // Add empty assistant message
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
        },
      ])

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        assistantMessage += chunk

        // Update the message content as it streams
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMessageId
              ? { ...m, content: assistantMessage }
              : m
          )
        )
      }
    } catch (err) {
      console.error('Chat error:', err)
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsLoading(false)
    }
  }

  const handleFlagSubmit = async () => {
    if (!flagModal || !flagForm.expected_value) return
    setFlagSubmitting(true)
    try {
      // Find the user message that preceded this assistant message
      const msgIndex = messages.findIndex(m => m.id === flagModal.messageId)
      const precedingUserMsg = msgIndex > 0 ? messages[msgIndex - 1] : null

      const res = await fetch(`/api/projects/${projectId}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query_text: precedingUserMsg?.content ?? '',
          ai_response_excerpt: flagModal.messageContent.slice(0, 500),
          expected_value: flagForm.expected_value,
          submitted_by_role: flagForm.submitted_by_role,
          sheet_number: flagForm.sheet_number || null,
          notes: flagForm.notes || null,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `Server error ${res.status}`)
      }
      setFlagSuccess(true)
      setTimeout(() => {
        setFlagModal(null)
        setFlagSuccess(false)
        setFlagError(null)
        setFlagForm({ expected_value: '', submitted_by_role: 'engineer', sheet_number: '', notes: '' })
      }, 1500)
    } catch (err) {
      setFlagError(err instanceof Error ? err.message : 'Failed to save correction. Please try again.')
    } finally {
      setFlagSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col h-[600px] border border-gray-200 rounded-lg bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            Project Assistant
          </h3>
          <p className="text-sm text-gray-500">
            Ask questions about your documents
          </p>
        </div>
        <div className="flex items-center space-x-2">
          {isLoading && (
            <svg
              className="animate-spin h-5 w-5 text-blue-600"
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
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-3">
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
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              <div>
                <h3 className="text-sm font-medium text-gray-900">
                  Start a conversation
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  Ask questions about your project documents
                </p>
              </div>
              <div className="text-xs text-gray-400 space-y-1">
                <p>Try asking:</p>
                <p>"How many gate valves are on Water Line A?"</p>
                <p>"What is the bedding requirement for 12-inch DI pipe?"</p>
                <p>"What does Sheet C-003 show at Sta 12+50?"</p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div className="max-w-[80%] space-y-1">
                  <div
                    className={`rounded-lg px-4 py-2 ${
                      message.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-900'
                    }`}
                  >
                    {message.role === 'assistant' && (
                      <div className="flex items-center space-x-2 mb-2">
                        <svg
                          className="h-5 w-5 text-blue-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-xs font-medium text-gray-500">
                          Assistant
                        </span>
                      </div>
                    )}
                    <div className="text-sm whitespace-pre-wrap">
                      {message.content}
                    </div>
                  </div>
                  {message.role === 'assistant' && message.content && (
                    <div className="flex justify-start pl-1">
                      <button
                        onClick={() => setFlagModal({ messageId: message.id, messageContent: message.content })}
                        className="text-xs text-gray-400 hover:text-red-500 transition-colors flex items-center space-x-1"
                      >
                        <span>⚑</span>
                        <span>Flag Issue</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </>
        )}

        {error && (
          <div className="flex justify-center">
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 max-w-[80%]">
              <p className="text-sm text-red-600">
                Error: {error}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        className="border-t border-gray-200 p-4 bg-gray-50"
      >
        <div className="flex space-x-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about your documents..."
            disabled={isLoading}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isLoading ? (
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
              </span>
            ) : (
              'Send'
            )}
          </button>
        </div>
      </form>

      {/* Flag Issue Modal */}
      {flagModal && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => { setFlagModal(null); setFlagError(null) }}
        >
          <div
            className="bg-white rounded-lg p-6 w-full max-w-md mx-4 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Flag an Issue</h3>
              <button onClick={() => { setFlagModal(null); setFlagError(null) }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            {flagSuccess ? (
              <p className="text-green-600 text-sm font-medium">Correction saved. Thank you.</p>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    What should the correct answer be? *
                  </label>
                  <textarea
                    value={flagForm.expected_value}
                    onChange={e => setFlagForm(f => ({ ...f, expected_value: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    rows={3}
                    placeholder="e.g. There are 14 gate valves, not 12. Sheet C-003 shows 2 additional at Sta 12+50."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Your Role</label>
                    <select
                      value={flagForm.submitted_by_role}
                      onChange={e => setFlagForm(f => ({ ...f, submitted_by_role: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    >
                      <option value="PE">PE</option>
                      <option value="superintendent">Superintendent</option>
                      <option value="admin">Admin</option>
                      <option value="engineer">Engineer</option>
                      <option value="foreman">Foreman</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sheet Number</label>
                    <input
                      value={flagForm.sheet_number}
                      onChange={e => setFlagForm(f => ({ ...f, sheet_number: e.target.value }))}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                      placeholder="e.g. C-003"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                  <input
                    value={flagForm.notes}
                    onChange={e => setFlagForm(f => ({ ...f, notes: e.target.value }))}
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                    placeholder="Additional context..."
                  />
                </div>

                {flagError && (
                  <p className="text-red-600 text-sm">{flagError}</p>
                )}

                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => { setFlagModal(null); setFlagError(null) }}
                    className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleFlagSubmit}
                    disabled={flagSubmitting || !flagForm.expected_value}
                    className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                  >
                    {flagSubmitting ? 'Saving...' : 'Submit Correction'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
