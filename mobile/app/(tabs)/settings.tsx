import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native'
import { router } from 'expo-router'
import FontAwesome from '@expo/vector-icons/FontAwesome'
import * as Haptics from 'expo-haptics'

import { useAuth } from '../../hooks/useAuth'
import { useAppStore } from '../../stores/appStore'

export default function SettingsScreen() {
  const { user, signOut } = useAuth()
  const { theme, setTheme, selectedProject, setSelectedProject } = useAppStore()

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
          setSelectedProject(null)
          await signOut()
          router.replace('/(auth)/sign-in')
        },
      },
    ])
  }

  const handleThemeChange = () => {
    Haptics.selectionAsync()
    const themes: Array<'light' | 'dark' | 'system'> = [
      'light',
      'dark',
      'system',
    ]
    const currentIndex = themes.indexOf(theme)
    const nextTheme = themes[(currentIndex + 1) % themes.length]
    setTheme(nextTheme)
  }

  return (
    <ScrollView style={styles.container}>
      {/* User Info */}
      <View style={styles.section}>
        <View style={styles.userCard}>
          <View style={styles.avatar}>
            <FontAwesome name="user" size={28} color="#2563EB" />
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userEmail}>{user?.email ?? 'Not signed in'}</Text>
            <Text style={styles.userLabel}>Account</Text>
          </View>
        </View>
      </View>

      {/* Active Project */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Active Project</Text>
        <TouchableOpacity
          style={styles.settingRow}
          onPress={() => router.push('/(tabs)')}
        >
          <View style={styles.settingIcon}>
            <FontAwesome name="folder" size={18} color="#2563EB" />
          </View>
          <View style={styles.settingContent}>
            <Text style={styles.settingLabel}>
              {selectedProject?.name ?? 'None selected'}
            </Text>
            <Text style={styles.settingValue}>Tap to change</Text>
          </View>
          <FontAwesome name="chevron-right" size={16} color="#9CA3AF" />
        </TouchableOpacity>
      </View>

      {/* Preferences */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>

        <TouchableOpacity style={styles.settingRow} onPress={handleThemeChange}>
          <View style={styles.settingIcon}>
            <FontAwesome
              name={theme === 'dark' ? 'moon-o' : 'sun-o'}
              size={18}
              color="#2563EB"
            />
          </View>
          <View style={styles.settingContent}>
            <Text style={styles.settingLabel}>Theme</Text>
            <Text style={styles.settingValue}>
              {theme.charAt(0).toUpperCase() + theme.slice(1)}
            </Text>
          </View>
          <FontAwesome name="chevron-right" size={16} color="#9CA3AF" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.settingRow} disabled>
          <View style={styles.settingIcon}>
            <FontAwesome name="microphone" size={18} color="#9CA3AF" />
          </View>
          <View style={styles.settingContent}>
            <Text style={[styles.settingLabel, styles.disabled]}>
              Voice Settings
            </Text>
            <Text style={styles.settingValue}>Coming in Phase 5</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.settingRow} disabled>
          <View style={styles.settingIcon}>
            <FontAwesome name="cloud-download" size={18} color="#9CA3AF" />
          </View>
          <View style={styles.settingContent}>
            <Text style={[styles.settingLabel, styles.disabled]}>
              Offline Storage
            </Text>
            <Text style={styles.settingValue}>Coming in Phase 5</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* About */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>

        <View style={styles.settingRow}>
          <View style={styles.settingIcon}>
            <FontAwesome name="info-circle" size={18} color="#2563EB" />
          </View>
          <View style={styles.settingContent}>
            <Text style={styles.settingLabel}>Version</Text>
            <Text style={styles.settingValue}>1.0.0 (Phase 4)</Text>
          </View>
        </View>
      </View>

      {/* Sign Out */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <FontAwesome name="sign-out" size={18} color="#EF4444" />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Construction Copilot</Text>
        <Text style={styles.footerSubtext}>Built for the field</Text>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  section: {
    marginTop: 24,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    marginBottom: 8,
    marginLeft: 4,
  },
  userCard: {
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
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#EFF6FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  userInfo: {
    flex: 1,
  },
  userEmail: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  userLabel: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  settingIcon: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  settingContent: {
    flex: 1,
  },
  settingLabel: {
    fontSize: 16,
    color: '#111827',
  },
  settingValue: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 2,
  },
  disabled: {
    color: '#9CA3AF',
  },
  signOutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEF2F2',
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  footerText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
  },
  footerSubtext: {
    fontSize: 14,
    color: '#9CA3AF',
    marginTop: 4,
  },
})
