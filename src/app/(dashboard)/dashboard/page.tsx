import Link from 'next/link'

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Welcome to Construction Copilot
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/projects"
          className="bg-white overflow-hidden shadow rounded-lg hover:shadow-md transition-shadow"
        >
          <div className="p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-3xl">🏗️</span>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Projects
                  </dt>
                  <dd className="text-lg font-semibold text-gray-900">
                    View all projects
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </Link>

        <div className="bg-white overflow-hidden shadow rounded-lg opacity-50">
          <div className="p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-3xl">📄</span>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Documents
                  </dt>
                  <dd className="text-lg font-semibold text-gray-900">
                    Coming in Phase 2
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg opacity-50">
          <div className="p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-3xl">🤖</span>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    AI Assistant
                  </dt>
                  <dd className="text-lg font-semibold text-gray-900">
                    Coming in Phase 3
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
