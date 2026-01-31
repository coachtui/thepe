import { redirect } from 'next/navigation'
import { createClient } from '@/lib/db/supabase/server'
import { getUserProfile } from '@/lib/db/queries/users'
import { Sidebar } from '@/components/layout/sidebar'
import { UserMenu } from '@/components/layout/user-menu'
import type { Database } from '@/lib/db/supabase/types'

type UserProfile = Database['public']['Tables']['users']['Row']

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  let userProfile: UserProfile | null = null
  try {
    userProfile = await getUserProfile(user.id)
  } catch (error) {
    redirect('/sign-up')
  }

  if (!userProfile) {
    redirect('/sign-up')
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar />

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200">
          <div className="flex items-center justify-between h-16 px-6">
            <h2 className="text-lg font-semibold text-gray-800">
              {/* Page title can be dynamically set by child pages */}
            </h2>
            <UserMenu
              user={{
                email: (userProfile as UserProfile).email,
                full_name: (userProfile as UserProfile).full_name,
              }}
            />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
