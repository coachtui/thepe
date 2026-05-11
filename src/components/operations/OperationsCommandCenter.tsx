'use client'

import { useState } from 'react'
import { FowReadinessTab } from './tabs/FowReadinessTab'

type Tab = 'fow'

const TABS: { id: Tab; label: string }[] = [
  { id: 'fow', label: 'Features of Work' },
]

interface OperationsCommandCenterProps {
  projectId: string
}

export function OperationsCommandCenter({ projectId }: OperationsCommandCenterProps) {
  const [activeTab, setActiveTab] = useState<Tab>('fow')

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap pb-3 px-1 border-b-2 text-sm font-medium cursor-pointer ${
                activeTab === tab.id
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'fow' && <FowReadinessTab projectId={projectId} />}
      </div>
    </div>
  )
}
