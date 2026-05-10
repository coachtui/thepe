import Link from 'next/link'

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6 py-24">
      <div className="text-center max-w-2xl w-full">

        {/* Logo mark */}
        <div className="flex justify-center mb-8">
          <div className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center shadow-sm">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21" />
            </svg>
          </div>
        </div>

        <h1 className="text-4xl font-bold text-slate-900 tracking-tight">
          Construction Copilot
        </h1>
        <p className="mt-3 text-lg text-slate-500">
          AI-powered document intelligence for construction professionals
        </p>

        <div className="flex gap-3 justify-center mt-10">
          <Link
            href="/sign-up"
            className="px-6 py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-colors duration-150 shadow-sm"
          >
            Get Started
          </Link>
          <Link
            href="/sign-in"
            className="px-6 py-2.5 border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg hover:bg-white hover:border-slate-300 transition-colors duration-150"
          >
            Sign In
          </Link>
        </div>

        {/* Feature cards */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Document Intelligence</h3>
            <p className="text-xs text-slate-500 leading-relaxed">Upload specs and drawings. Get answers backed by page citations.</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Submittal Register</h3>
            <p className="text-xs text-slate-500 leading-relaxed">Track submittals, coverage gaps, and approval workflows in one place.</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="w-9 h-9 bg-slate-100 rounded-lg flex items-center justify-center mb-4">
              <svg className="w-5 h-5 text-slate-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12 11.204 3.045c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Project Management</h3>
            <p className="text-xs text-slate-500 leading-relaxed">Organize projects, manage teams, and keep everything in one place.</p>
          </div>
        </div>
      </div>
    </main>
  )
}
