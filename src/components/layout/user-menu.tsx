'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/db/supabase/client'

interface UserMenuProps {
  user: {
    email?: string
    full_name?: string | null
  }
}

export function UserMenu({ user }: UserMenuProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/sign-in')
    router.refresh()
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-3 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-md"
      >
        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-semibold">
          {(user.full_name || user.email || 'U')[0].toUpperCase()}
        </div>
        <div className="text-left">
          <div className="text-sm font-medium text-gray-900">
            {user.full_name || 'User'}
          </div>
          <div className="text-xs text-gray-500">{user.email}</div>
        </div>
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-20 border border-gray-200">
            <button
              onClick={handleSignOut}
              className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  )
}
