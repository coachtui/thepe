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

      const { data: profile } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      const userProfile = profile as UserProfile | null

      if (userProfile?.organization_id) {
        const { data: org } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', userProfile.organization_id)
          .single()

        setOrganization(org)

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
        <p className="text-sm text-slate-400">Loading settings...</p>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Manage your organization and team</p>
      </div>

      {/* Organization */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-4">Organization</h2>
        {organization ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Name</p>
              <p className="text-sm text-slate-900">{organization.name}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Created</p>
              <p className="text-sm text-slate-900">
                {organization.created_at
                  ? new Date(organization.created_at).toLocaleDateString()
                  : 'N/A'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No organization found</p>
        )}
      </div>

      {/* Members */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-slate-900">
            Team Members
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
              {members.length}
            </span>
          </h2>
          <button
            disabled
            className="px-3 py-1.5 text-sm border border-slate-200 text-slate-400 rounded-lg cursor-not-allowed"
            title="Coming soon"
          >
            Invite Member
          </button>
        </div>

        {members.length > 0 ? (
          <div className="space-y-2">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors duration-150"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                    {(member.full_name || member.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {member.full_name || 'No name'}
                    </p>
                    <p className="text-xs text-slate-400">{member.email}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400">
                  Joined {member.created_at ? new Date(member.created_at).toLocaleDateString() : 'N/A'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No members found</p>
        )}
      </div>

      {/* Coming soon */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Coming Soon</h3>
        <ul className="space-y-1.5 text-sm text-slate-500">
          <li className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-slate-300" />
            Invite team members via email
          </li>
          <li className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-slate-300" />
            Manage member roles and permissions
          </li>
          <li className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-slate-300" />
            Edit organization details
          </li>
          <li className="flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-slate-300" />
            Billing and subscription management
          </li>
        </ul>
      </div>
    </div>
  )
}
