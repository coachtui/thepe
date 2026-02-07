import { create } from 'zustand'
import { Project } from '../hooks/useProjects'

interface AppState {
  // Selected project context
  selectedProject: Project | null
  setSelectedProject: (project: Project | null) => void

  // UI state
  isOnline: boolean
  setIsOnline: (online: boolean) => void

  // Theme
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark' | 'system') => void
}

export const useAppStore = create<AppState>((set) => ({
  // Selected project
  selectedProject: null,
  setSelectedProject: (project) => set({ selectedProject: project }),

  // Network status
  isOnline: true,
  setIsOnline: (online) => set({ isOnline: online }),

  // Theme
  theme: 'system',
  setTheme: (theme) => set({ theme }),
}))
