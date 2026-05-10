'use client'

import { useRef, useState, useEffect } from 'react'
import type { SubmittalRegisterItem } from '@/lib/chat/submittal-register'
import { buildExportRows, EXPORT_COLUMNS } from '@/lib/export/submittal-export'

interface ExportDropdownProps {
  projectId: string
  allItems: SubmittalRegisterItem[]
  filteredItems: SubmittalRegisterItem[]
  filtersActive: boolean
}

export function ExportDropdown({
  projectId,
  allItems,
  filteredItems,
  filtersActive,
}: ExportDropdownProps) {
  const [open, setOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  async function doExport(items: SubmittalRegisterItem[]) {
    if (items.length === 0) return
    setExporting(true)
    setOpen(false)
    try {
      const XLSX = await import('xlsx')
      const rows = buildExportRows(items)

      const ws = XLSX.utils.json_to_sheet(rows, {
        header: EXPORT_COLUMNS.map(c => c.key),
      })

      ws['!cols'] = EXPORT_COLUMNS.map(c => ({ wch: c.width }))

      // Freeze header row
      ws['!freeze'] = { xSplit: 0, ySplit: 1 }

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Submittal Register')

      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `submittal-register-${projectId}-${date}.xlsx`)
    } catch (err) {
      console.error('[ExportDropdown] export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  const disabled = exporting || allItems.length === 0

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
      >
        {exporting ? 'Exporting…' : <>Export <span className="text-gray-400 text-xs">▾</span></>}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-56 bg-white border border-gray-200 rounded-md shadow-lg py-1">
          {filtersActive && (
            <button
              type="button"
              onClick={() => doExport(filteredItems)}
              disabled={filteredItems.length === 0}
              className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40 cursor-pointer"
            >
              Export filtered view
              <span className="block text-xs text-gray-400 mt-0.5">
                {filteredItems.length} item{filteredItems.length === 1 ? '' : 's'}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => doExport(allItems)}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
          >
            Export full register
            <span className="block text-xs text-gray-400 mt-0.5">
              {allItems.length} item{allItems.length === 1 ? '' : 's'}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
