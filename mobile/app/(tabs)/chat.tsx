import { useState, useRef, useEffect } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { router } from 'expo-router'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import * as Haptics from 'expo-haptics'

import { useChat, ChatMessage } from '../../hooks/useChat'
import { useAppStore } from '../../stores/appStore'

export default function ChatScreen() {
  const selectedProject = useAppStore((s) => s.selectedProject)
  const { messages, isStreaming, error, sendMessage, clearMessages } = useChat(
    selectedProject?.id ?? null
  )
  const [inputText, setInputText] = useState('')
  const flatListRef = useRef<FlatList>(null)

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }, 100)
    }
  }, [messages])

  const handleSend = async () => {
    if (!inputText.trim() || isStreaming) return

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const text = inputText
    setInputText('')
    await sendMessage(text)
  }

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.role === 'user'
    return (
      <View
        style={[
          styles.messageBubble,
          isUser ? styles.userBubble : styles.assistantBubble,
        ]}
      >
        {!isUser && (
          <View style={styles.assistantIcon}>
            <FontAwesome name="bolt" size={14} color="#2563EB" />
          </View>
        )}
        <View style={styles.messageContent}>
          <Text
            style={[
              styles.messageText,
              isUser ? styles.userText : styles.assistantText,
            ]}
          >
            {item.content || (isStreaming && !item.content ? '...' : '')}
          </Text>
        </View>
      </View>
    )
  }

  // No project selected
  if (!selectedProject) {
    return (
      <View style={styles.centered}>
        <FontAwesome name="folder-open-o" size={64} color="#D1D5DB" />
        <Text style={styles.noProjectTitle}>Select a Project</Text>
        <Text style={styles.noProjectSubtitle}>
          Choose a project from the Projects tab to start chatting
        </Text>
        <TouchableOpacity
          style={styles.goToProjectsButton}
          onPress={() => router.push('/(tabs)')}
        >
          <Text style={styles.goToProjectsText}>Go to Projects</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header with project name */}
      <View style={styles.header}>
        <Text style={styles.projectName} numberOfLines={1}>
          {selectedProject.name}
        </Text>
        {messages.length > 0 && (
          <TouchableOpacity onPress={clearMessages} style={styles.clearButton}>
            <FontAwesome name="trash-o" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Messages */}
      {messages.length === 0 ? (
        <View style={styles.emptyChat}>
          <FontAwesome name="comments-o" size={64} color="#D1D5DB" />
          <Text style={styles.emptyChatTitle}>Ask anything</Text>
          <Text style={styles.emptyChatSubtitle}>
            Ask questions about your construction documents
          </Text>
          <View style={styles.suggestions}>
            <TouchableOpacity
              style={styles.suggestionChip}
              onPress={() => sendMessage('How many gate valves are there?')}
            >
              <Text style={styles.suggestionText}>
                How many gate valves are there?
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.suggestionChip}
              onPress={() =>
                sendMessage("What's the total length of the water line?")
              }
            >
              <Text style={styles.suggestionText}>
                What's the total length of the water line?
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderMessage}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
        />
      )}

      {/* Error */}
      {error && (
        <View style={styles.errorBar}>
          <FontAwesome name="exclamation-circle" size={16} color="#EF4444" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            style={styles.input}
            placeholder="Ask about your documents..."
            placeholderTextColor="#9CA3AF"
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={2000}
            editable={!isStreaming}
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              (!inputText.trim() || isStreaming) && styles.sendButtonDisabled,
            ]}
            onPress={handleSend}
            disabled={!inputText.trim() || isStreaming}
          >
            {isStreaming ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <FontAwesome name="arrow-up" size={18} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        </View>
        {/* Voice button placeholder - Phase 5 */}
        <TouchableOpacity style={styles.voiceButton} disabled>
          <FontAwesome name="microphone" size={20} color="#9CA3AF" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  noProjectTitle: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
  },
  noProjectSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  goToProjectsButton: {
    marginTop: 24,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#2563EB',
    borderRadius: 8,
  },
  goToProjectsText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  projectName: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  clearButton: {
    padding: 8,
  },
  emptyChat: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyChatTitle: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
  },
  emptyChatSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  suggestions: {
    marginTop: 24,
    gap: 12,
  },
  suggestionChip: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  suggestionText: {
    fontSize: 14,
    color: '#374151',
  },
  messageList: {
    padding: 16,
    gap: 16,
  },
  messageBubble: {
    flexDirection: 'row',
    maxWidth: '85%',
  },
  userBubble: {
    alignSelf: 'flex-end',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
  },
  assistantIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  messageContent: {
    flex: 1,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
    padding: 12,
    borderRadius: 16,
  },
  userText: {
    backgroundColor: '#2563EB',
    color: '#FFFFFF',
    borderBottomRightRadius: 4,
  },
  assistantText: {
    backgroundColor: '#FFFFFF',
    color: '#111827',
    borderBottomLeftRadius: 4,
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FEF2F2',
  },
  errorText: {
    fontSize: 14,
    color: '#EF4444',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    gap: 8,
  },
  inputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#F3F4F6',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    maxHeight: 100,
    paddingVertical: 4,
  },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2563EB',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#93C5FD',
  },
  voiceButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F3F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
})
