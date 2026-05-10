'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/db/supabase/client'

interface ProjectCost {
  id: string
  name: string
  totalCost: number
  documentCount: number
}

interface DocumentCost {
  id: string
  name: string
  projectName: string
  visionCost: number
  sheetsProcessed: number
  quantitiesExtracted: number
  processedAt: string | null
}

interface MonthlyCost {
  month: string
  cost: number
}

const TH = 'px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider'
const TD = 'px-4 py-3 text-sm text-slate-700'
const TD_RIGHT = 'px-4 py-3 text-sm text-slate-700 text-right'

export default function UsagePage() {
  const [loading, setLoading] = useState(true)
  const [totalCost, setTotalCost] = useState(0)
  const [projectCosts, setProjectCosts] = useState<ProjectCost[]>([])
  const [documentCosts, setDocumentCosts] = useState<DocumentCost[]>([])
  const [monthlyCosts, setMonthlyCosts] = useState<MonthlyCost[]>([])

  useEffect(() => {
    async function loadCostData() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (!profile?.organization_id) return

      const { data: projects } = await supabase
        .from('projects')
        .select('id, name, organization_id')
        .eq('organization_id', profile.organization_id)

      if (!projects) return

      const projectIds = projects.map((p) => p.id)

      const { data: documents } = await supabase
        .from('documents')
        .select(`id, filename, project_id, vision_cost_usd, vision_sheets_processed, vision_quantities_extracted, vision_processed_at`)
        .in('project_id', projectIds)
        .not('vision_cost_usd', 'is', null)
        .order('vision_processed_at', { ascending: false })

      if (!documents) return

      const total = documents.reduce((sum, doc) => sum + (doc.vision_cost_usd || 0), 0)
      setTotalCost(total)

      const projectMap = new Map<string, ProjectCost>()
      projects.forEach((p) => {
        projectMap.set(p.id, { id: p.id, name: p.name, totalCost: 0, documentCount: 0 })
      })
      documents.forEach((doc) => {
        if (!doc.project_id) return
        const project = projectMap.get(doc.project_id)
        if (project) {
          project.totalCost += doc.vision_cost_usd || 0
          project.documentCount += 1
        }
      })
      setProjectCosts(
        Array.from(projectMap.values())
          .filter((p) => p.documentCount > 0)
          .sort((a, b) => b.totalCost - a.totalCost)
      )

      setDocumentCosts(
        documents.map((doc) => {
          const project = projects.find((p) => p.id === doc.project_id)
          return {
            id: doc.id,
            name: doc.filename,
            projectName: project?.name || 'Unknown',
            visionCost: doc.vision_cost_usd || 0,
            sheetsProcessed: doc.vision_sheets_processed || 0,
            quantitiesExtracted: doc.vision_quantities_extracted || 0,
            processedAt: doc.vision_processed_at,
          }
        })
      )

      const monthlyMap = new Map<string, number>()
      const now = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        monthlyMap.set(d.toISOString().slice(0, 7), 0)
      }
      documents.forEach((doc) => {
        if (doc.vision_processed_at) {
          const month = doc.vision_processed_at.slice(0, 7)
          if (monthlyMap.has(month)) {
            monthlyMap.set(month, (monthlyMap.get(month) || 0) + (doc.vision_cost_usd || 0))
          }
        }
      })
      setMonthlyCosts(
        Array.from(monthlyMap.entries()).map(([month, cost]) => ({ month, cost }))
      )

      setLoading(false)
    }

    loadCostData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-slate-400">Loading usage data...</p>
      </div>
    )
  }

  const maxMonthlyCost = Math.max(...monthlyCosts.map((m) => m.cost), 0.01)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Usage &amp; Costs</h1>
        <p className="mt-1 text-sm text-slate-500">Vision API usage and cost tracking</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400">Total Vision Cost</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">${totalCost.toFixed(2)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 bg-sky-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-sky-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400">Documents Processed</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">{documentCosts.length}</p>
            </div>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-4">
            <div className="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0 0 20.25 18V6A2.25 2.25 0 0 0 18 3.75H6A2.25 2.25 0 0 0 3.75 6v12A2.25 2.25 0 0 0 6 20.25Z" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400">Avg Cost / Document</p>
              <p className="text-xl font-bold text-slate-900 mt-0.5">
                ${documentCosts.length > 0 ? (totalCost / documentCosts.length).toFixed(2) : '0.00'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly chart */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-5">Monthly Usage (Last 6 Months)</h2>
        <div className="space-y-3">
          {monthlyCosts.map(({ month, cost }) => {
            const percentage = maxMonthlyCost > 0 ? (cost / maxMonthlyCost) * 100 : 0
            const monthLabel = new Date(month + '-01').toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric',
            })
            return (
              <div key={month} className="flex items-center gap-4">
                <div className="w-20 text-xs text-slate-500 flex-shrink-0">{monthLabel}</div>
                <div className="flex-1 bg-slate-100 rounded-full h-5 overflow-hidden">
                  <div
                    className="bg-amber-400 h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(percentage, 0)}%` }}
                  />
                </div>
                <div className="w-16 text-xs font-medium text-slate-900 text-right flex-shrink-0">
                  ${cost.toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-project */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Cost by Project</h2>
        </div>
        {projectCosts.length === 0 ? (
          <div className="px-6 py-8">
            <p className="text-sm text-slate-400">No projects with vision costs yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Project</th>
                  <th className={TH + ' text-right'}>Documents</th>
                  <th className={TH + ' text-right'}>Total Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projectCosts.map((project) => (
                  <tr key={project.id} className="hover:bg-slate-50 transition-colors duration-100">
                    <td className={TD}>{project.name}</td>
                    <td className={TD_RIGHT}>{project.documentCount}</td>
                    <td className={TD_RIGHT + ' font-medium'}>${project.totalCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-document */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="text-sm font-semibold text-slate-900">Document Details</h2>
        </div>
        {documentCosts.length === 0 ? (
          <div className="px-6 py-8">
            <p className="text-sm text-slate-400">No documents processed yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className={TH}>Document</th>
                  <th className={TH}>Project</th>
                  <th className={TH + ' text-right'}>Sheets</th>
                  <th className={TH + ' text-right'}>Quantities</th>
                  <th className={TH + ' text-right'}>Cost</th>
                  <th className={TH + ' text-right'}>Processed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {documentCosts.map((doc) => (
                  <tr key={doc.id} className="hover:bg-slate-50 transition-colors duration-100">
                    <td className={TD + ' max-w-xs truncate'} title={doc.name}>{doc.name}</td>
                    <td className={TD}>{doc.projectName}</td>
                    <td className={TD_RIGHT}>{doc.sheetsProcessed}</td>
                    <td className={TD_RIGHT}>{doc.quantitiesExtracted}</td>
                    <td className={TD_RIGHT + ' font-medium'}>${doc.visionCost.toFixed(4)}</td>
                    <td className={TD_RIGHT}>
                      {doc.processedAt ? new Date(doc.processedAt).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
