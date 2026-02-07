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

export default function UsagePage() {
  const [loading, setLoading] = useState(true)
  const [totalCost, setTotalCost] = useState(0)
  const [projectCosts, setProjectCosts] = useState<ProjectCost[]>([])
  const [documentCosts, setDocumentCosts] = useState<DocumentCost[]>([])
  const [monthlyCosts, setMonthlyCosts] = useState<MonthlyCost[]>([])

  useEffect(() => {
    async function loadCostData() {
      const supabase = createClient()

      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Get user's organization
      const { data: profile } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single()

      if (!profile?.organization_id) return

      // Get all projects for this organization
      const { data: projects } = await supabase
        .from('projects')
        .select('id, name, organization_id')
        .eq('organization_id', profile.organization_id)

      if (!projects) return

      const projectIds = projects.map(p => p.id)

      // Get all documents with vision costs for these projects
      const { data: documents } = await supabase
        .from('documents')
        .select(`
          id,
          filename,
          project_id,
          vision_cost_usd,
          vision_sheets_processed,
          vision_quantities_extracted,
          vision_processed_at
        `)
        .in('project_id', projectIds)
        .not('vision_cost_usd', 'is', null)
        .order('vision_processed_at', { ascending: false })

      if (!documents) return

      // Calculate total cost
      const total = documents.reduce((sum, doc) => sum + (doc.vision_cost_usd || 0), 0)
      setTotalCost(total)

      // Calculate per-project costs
      const projectMap = new Map<string, ProjectCost>()
      projects.forEach(p => {
        projectMap.set(p.id, {
          id: p.id,
          name: p.name,
          totalCost: 0,
          documentCount: 0
        })
      })

      documents.forEach(doc => {
        if (!doc.project_id) return
        const project = projectMap.get(doc.project_id)
        if (project) {
          project.totalCost += doc.vision_cost_usd || 0
          project.documentCount += 1
        }
      })

      setProjectCosts(
        Array.from(projectMap.values())
          .filter(p => p.documentCount > 0)
          .sort((a, b) => b.totalCost - a.totalCost)
      )

      // Build document costs list
      const docCosts: DocumentCost[] = documents.map(doc => {
        const project = projects.find(p => p.id === doc.project_id)
        return {
          id: doc.id,
          name: doc.filename,
          projectName: project?.name || 'Unknown',
          visionCost: doc.vision_cost_usd || 0,
          sheetsProcessed: doc.vision_sheets_processed || 0,
          quantitiesExtracted: doc.vision_quantities_extracted || 0,
          processedAt: doc.vision_processed_at
        }
      })
      setDocumentCosts(docCosts)

      // Calculate monthly costs (last 6 months)
      const monthlyMap = new Map<string, number>()
      const now = new Date()
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        const key = d.toISOString().slice(0, 7) // YYYY-MM
        monthlyMap.set(key, 0)
      }

      documents.forEach(doc => {
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
        <div className="text-gray-500">Loading usage data...</div>
      </div>
    )
  }

  const maxMonthlyCost = Math.max(...monthlyCosts.map(m => m.cost), 0.01)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Usage & Costs</h1>
        <p className="mt-2 text-gray-600">
          Vision API usage and cost tracking
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-3xl">💰</span>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Total Vision Cost
                  </dt>
                  <dd className="text-2xl font-bold text-gray-900">
                    ${totalCost.toFixed(2)}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-3xl">📄</span>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Documents Processed
                  </dt>
                  <dd className="text-2xl font-bold text-gray-900">
                    {documentCosts.length}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-3xl">📊</span>
              </div>
              <div className="ml-5 w-0 flex-1">
                <dl>
                  <dt className="text-sm font-medium text-gray-500 truncate">
                    Avg Cost per Document
                  </dt>
                  <dd className="text-2xl font-bold text-gray-900">
                    ${documentCosts.length > 0 ? (totalCost / documentCosts.length).toFixed(2) : '0.00'}
                  </dd>
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Usage Chart */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Usage (Last 6 Months)</h2>
        <div className="space-y-3">
          {monthlyCosts.map(({ month, cost }) => {
            const percentage = maxMonthlyCost > 0 ? (cost / maxMonthlyCost) * 100 : 0
            const monthLabel = new Date(month + '-01').toLocaleDateString('en-US', {
              month: 'short',
              year: 'numeric'
            })
            return (
              <div key={month} className="flex items-center gap-4">
                <div className="w-20 text-sm text-gray-600">{monthLabel}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="bg-blue-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.max(percentage, 0)}%` }}
                  />
                </div>
                <div className="w-20 text-sm text-gray-900 text-right font-medium">
                  ${cost.toFixed(2)}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-Project Breakdown */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Cost by Project</h2>
        {projectCosts.length === 0 ? (
          <p className="text-gray-500">No projects with vision costs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Project
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Documents
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Total Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {projectCosts.map((project) => (
                  <tr key={project.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">{project.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{project.documentCount}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">
                      ${project.totalCost.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Per-Document Breakdown */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Document Details</h2>
        {documentCosts.length === 0 ? (
          <p className="text-gray-500">No documents processed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Document
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Project
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Sheets
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quantities
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cost
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Processed
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {documentCosts.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900 max-w-xs truncate" title={doc.name}>
                      {doc.name}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{doc.projectName}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{doc.sheetsProcessed}</td>
                    <td className="px-4 py-3 text-sm text-gray-600 text-right">{doc.quantitiesExtracted}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right">
                      ${doc.visionCost.toFixed(4)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 text-right">
                      {doc.processedAt
                        ? new Date(doc.processedAt).toLocaleDateString()
                        : '-'
                      }
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
