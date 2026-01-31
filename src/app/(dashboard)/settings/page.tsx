'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/db/supabase/client'
import type { Database } from '@/lib/db/supabase/types'

type UserProfile = Database['public']['Tables']['users']['Row']

interface Organization {
  id: string
  name: string
  created_at: string | null
}

interface Member {
  id: string
  email: string
  full_name: string | null
  created_at: string | null
}

export default function SettingsPage() {
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) return

      // Get user profile to find organization
      const { data: profile } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      const userProfile = profile as UserProfile | null

      if (userProfile?.organization_id) {
        // Get organization
        const { data: org } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', userProfile.organization_id)
          .single()

        setOrganization(org)

        // Get organization members
        const { data: orgMembers } = await supabase
          .from('users')
          .select('id, email, full_name, created_at')
          .eq('organization_id', userProfile.organization_id)
          .order('created_at', { ascending: true })

        setMembers(orgMembers || [])
      }
    } catch (error) {
      console.error('Error loading settings:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
        <p className="mt-2 text-gray-600">
          Manage your organization settings and members
        </p>
      </div>

      {/* Organization Details */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">
          Organization
        </h2>
        {organization ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-500">
                Organization Name
              </label>
              <p className="mt-1 text-lg text-gray-900">{organization.name}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">
                Created
              </label>
              <p className="mt-1 text-gray-900">
                {organization.created_at ? new Date(organization.created_at).toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-gray-500">No organization found</p>
        )}
      </div>

      {/* Organization Members */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-gray-900">
            Members ({members.length})
          </h2>
          <button
            disabled
            className="px-4 py-2 bg-gray-300 text-gray-500 rounded-md cursor-not-allowed"
            title="Coming in Phase 1.5"
          >
            Invite Member
          </button>
        </div>

        {members.length > 0 ? (
          <div className="space-y-3">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
              >
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
                    {(member.full_name || member.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {member.full_name || 'No name'}
                    </p>
                    <p className="text-sm text-gray-500">{member.email}</p>
                  </div>
                </div>
                <div className="text-sm text-gray-500">
                  Joined {member.created_at ? new Date(member.created_at).toLocaleDateString() : 'N/A'}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500">No members found</p>
        )}
      </div>

      {/* Future Features */}
      <div className="bg-gray-50 rounded-lg p-6 border-2 border-dashed border-gray-300">
        <h3 className="text-lg font-medium text-gray-700 mb-2">
          Coming Soon
        </h3>
        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
          <li>Invite team members via email</li>
          <li>Manage member roles and permissions</li>
          <li>Edit organization details</li>
          <li>Organization billing settings</li>
        </ul>
      </div>
    </div>
  )
}
