import { useState } from 'react'
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { router } from 'expo-router'
import FontAwesome from '@expo/vector-icons/FontAwesome'

import { useAppStore } from '../../stores/appStore'
import { useDocuments, Document } from '../../hooks/useDocuments'

export default function DocumentsScreen() {
  const selectedProject = useAppStore((s) => s.selectedProject)
  const { documents, loading, error, refresh } = useDocuments(selectedProject?.id ?? null)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    await refresh()
    setRefreshing(false)
  }

  const handleDocumentPress = (doc: Document) => {
    Alert.alert('Coming Soon', 'PDF viewer will be available in the next update')
  }

  const getFileIcon = (fileType: string) => {
    if (fileType.includes('pdf')) return 'file-pdf-o'
    if (fileType.includes('image')) return 'file-image-o'
    if (fileType.includes('word') || fileType.includes('doc'))
      return 'file-word-o'
    if (fileType.includes('excel') || fileType.includes('sheet'))
      return 'file-excel-o'
    return 'file-o'
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return { bg: '#D1FAE5', text: '#065F46' }
      case 'processing':
        return { bg: '#FEF3C7', text: '#92400E' }
      case 'failed':
        return { bg: '#FEE2E2', text: '#991B1B' }
      default:
        return { bg: '#E5E7EB', text: '#374151' }
    }
  }

  const renderDocument = ({ item }: { item: Document }) => {
    const statusColor = getStatusColor(item.processing_status)

    return (
      <TouchableOpacity
        style={styles.documentCard}
        onPress={() => handleDocumentPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.documentIcon}>
          <FontAwesome
            name={getFileIcon(item.file_type)}
            size={24}
            color="#2563EB"
          />
        </View>
        <View style={styles.documentInfo}>
          <Text style={styles.documentName} numberOfLines={2}>
            {item.filename}
          </Text>
          <View style={styles.documentMeta}>
            <View
              style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}
            >
              <Text style={[styles.statusText, { color: statusColor.text }]}>
                {item.processing_status}
              </Text>
            </View>
            {item.document_type && (
              <Text style={styles.documentType}>{item.document_type}</Text>
            )}
          </View>
        </View>
        <FontAwesome name="chevron-right" size={16} color="#9CA3AF" />
      </TouchableOpacity>
    )
  }

  // No project selected
  if (!selectedProject) {
    return (
      <View style={styles.centered}>
        <FontAwesome name="folder-open-o" size={64} color="#D1D5DB" />
        <Text style={styles.noProjectTitle}>Select a Project</Text>
        <Text style={styles.noProjectSubtitle}>
          Choose a project from the Projects tab to view documents
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

  if (loading && !refreshing) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
        <Text style={styles.loadingText}>Loading documents...</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <FontAwesome name="exclamation-circle" size={48} color="#EF4444" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refresh}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {/* Header with project name */}
      <View style={styles.header}>
        <Text style={styles.projectName} numberOfLines={1}>
          {selectedProject.name}
        </Text>
        <Text style={styles.documentCount}>
          {documents.length} document{documents.length !== 1 ? 's' : ''}
        </Text>
      </View>

      {documents.length === 0 ? (
        <View style={styles.centered}>
          <FontAwesome name="file-o" size={64} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>No Documents</Text>
          <Text style={styles.emptySubtitle}>
            Upload documents in the web app to see them here
          </Text>
        </View>
      ) : (
        <FlatList
          data={documents}
          renderItem={renderDocument}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              colors={['#2563EB']}
              tintColor="#2563EB"
            />
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </View>
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
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    color: '#EF4444',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#2563EB',
    borderRadius: 8,
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
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
  emptyTitle: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: '600',
    color: '#374151',
  },
  emptySubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
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
  documentCount: {
    fontSize: 14,
    color: '#6B7280',
  },
  list: {
    padding: 16,
  },
  documentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  documentIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  documentInfo: {
    flex: 1,
    marginRight: 8,
  },
  documentName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  documentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  documentType: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  separator: {
    height: 12,
  },
})
