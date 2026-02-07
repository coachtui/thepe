import { useState, useCallback } from 'react'
import { streamChat } from '../lib/api'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export function useChat(projectId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendMessage = useCallback(
    async (content: string) => {
      if (!projectId || !content.trim()) return

      setError(null)

      // Add user message
      const userMessage: ChatMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content: content.trim(),
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMessage])

      // Create placeholder for assistant response
      const assistantMessageId = `assistant-${Date.now()}`
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])

      setIsStreaming(true)

      try {
        // Format messages for API
        const apiMessages = [...messages, userMessage].map((m) => ({
          role: m.role,
          content: m.content,
        }))

        await streamChat(
          projectId,
          apiMessages,
          (chunk) => {
            // Update the assistant message with streamed content
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessageId
                  ? { ...m, content: m.content + chunk }
                  : m
              )
            )
          },
          () => {
            setIsStreaming(false)
          }
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to send message')
        // Remove the empty assistant message on error
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessageId))
        setIsStreaming(false)
      }
    },
    [projectId, messages]
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return {
    messages,
    isStreaming,
    error,
    sendMessage,
    clearMessages,
  }
}
