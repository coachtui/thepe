import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gradient-to-b from-gray-50 to-gray-100">
      <div className="text-center max-w-3xl">
        <div className="mb-8">
          <span className="text-6xl mb-4 block">🏗️</span>
          <h1 className="text-5xl font-bold mb-4 text-gray-900">
            Construction Copilot
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            AI-powered assistant for construction professionals
          </p>
        </div>

        <div className="flex gap-4 justify-center mb-12">
          <Link
            href="/sign-up"
            className="px-8 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors shadow-lg"
          >
            Get Started
          </Link>
          <Link
            href="/sign-in"
            className="px-8 py-3 bg-white text-gray-900 rounded-lg font-semibold hover:bg-gray-50 transition-colors border-2 border-gray-300"
          >
            Sign In
          </Link>
        </div>

        <div className="bg-white rounded-lg p-8 shadow-md border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            ✅ Phase 1 Complete
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-2xl mb-2">🔐</div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">
                Authentication
              </h3>
              <p className="text-xs text-gray-600">
                Secure sign up, sign in, and session management
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-2xl mb-2">📁</div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">
                Project Management
              </h3>
              <p className="text-xs text-gray-600">
                Create, edit, and manage construction projects
              </p>
            </div>
            <div className="p-4 bg-green-50 rounded-lg">
              <div className="text-2xl mb-2">👥</div>
              <h3 className="font-semibold text-sm text-gray-900 mb-1">
                Organizations
              </h3>
              <p className="text-xs text-gray-600">
                Multi-tenant organization management
              </p>
            </div>
          </div>
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              <strong>Coming Next:</strong> Document upload, AI-powered search, and intelligent assistant
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
