/**
 * Benchmark test cases for the evaluation harness.
 *
 * 5 disciplines × 4 question classes = 20 baseline cases.
 * Each case also carries a "trap" comment describing the failure mode it guards.
 *
 * Usage:
 *   import { ALL_CASES, getCasesByDiscipline, getCasesByClass } from './benchmark-cases'
 */

import type { EvalTestCase } from './types'

// ---------------------------------------------------------------------------
// Civil engineering
// ---------------------------------------------------------------------------

const CIVIL_CASES: EvalTestCase[] = [
  {
    id: 'civil-A-001',
    description: 'Simple retrieval: pipe material at a specific station',
    discipline: 'civil',
    questionClass: 'simple_retrieval',
    question: 'What is the pipe material for Water Line A at station 20+00?',
    projectId: null,
    answerContains: [],  // material name expected — left blank, test runner checks citation
    answerExcludes: ['I don\'t know', 'no information', 'cannot find'],
    expectedCitations: [],
    expectedQueryType: 'A',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: true,
    tags: ['civil', 'linear', 'station-specific'],
    traps: 'Station lookup must not bleed to adjacent water line segments or a different Water Line',
  },
  {
    id: 'civil-B-001',
    description: 'Enumeration: list all storm drain structures',
    discipline: 'civil',
    questionClass: 'enumeration',
    question: 'List all storm drain inlet and manhole structures on this project.',
    projectId: null,
    answerContains: ['storm drain', 'inlet', 'manhole'],
    answerExcludes: ['sanitary sewer', 'water line', 'I cannot find'],
    expectedCitations: [],
    minCitationCount: 2,
    expectedQueryType: 'B',
    expectedCoverageStatus: 'complete',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: true,
    tags: ['civil', 'enumeration', 'storm-drain'],
    traps: 'Must enumerate from structured data, not infer from a single sheet reference',
  },
  {
    id: 'civil-C-001',
    description: 'Measurement: total linear footage of a water line',
    discipline: 'civil',
    questionClass: 'measurement',
    question: 'What is the total length of Water Line A in linear feet?',
    projectId: null,
    answerContains: ['linear', 'feet', 'lf'],
    answerExcludes: ['storm drain', 'sanitary', 'I cannot determine'],
    expectedCitations: [],
    expectedQueryType: 'C',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: true,
    tags: ['civil', 'measurement', 'linear-system'],
    traps: 'Must sum across all segments/sheets, not return a single segment length',
  },
  {
    id: 'civil-D-001',
    description: 'Global: overall utility scope summary',
    discipline: 'civil',
    questionClass: 'global',
    question: 'Summarize the utility work on this project — what systems are being installed, removed, or relocated?',
    projectId: null,
    answerContains: ['water', 'storm'],
    answerExcludes: [],
    expectedCitations: [],
    expectedQueryType: 'D',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: false,
    tags: ['civil', 'global', 'scope-summary'],
    traps: 'Global summary must cite sheets, not fabricate system names not present in documents',
  },
]

// ---------------------------------------------------------------------------
// Structural engineering
// ---------------------------------------------------------------------------

const STRUCTURAL_CASES: EvalTestCase[] = [
  {
    id: 'struct-A-001',
    description: 'Simple retrieval: footing size at a grid intersection',
    discipline: 'structural',
    questionClass: 'simple_retrieval',
    question: 'What is the size and depth of footing F-1?',
    projectId: null,
    answerContains: ['footing', 'F-1'],
    answerExcludes: ['F-2', 'F-3', 'I cannot find'],
    expectedCitations: [],
    expectedQueryType: 'A',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: true,
    tags: ['structural', 'footing', 'lookup'],
    traps: 'Must return dimensions for F-1 specifically, not a neighboring footing type',
  },
  {
    id: 'struct-B-001',
    description: 'Enumeration: list structural elements at Level 1',
    discipline: 'structural',
    questionClass: 'enumeration',
    question: 'What structural elements are at Level 1 or the first floor?',
    projectId: null,
    answerContains: ['level', 'structural'],
    answerExcludes: ['level 2', 'level 3', 'roof'],
    expectedCitations: [],
    minCitationCount: 1,
    expectedQueryType: 'B',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: false,
    tags: ['structural', 'enumeration', 'level'],
    traps: 'Should not include elements from upper levels or roof structure',
  },
  {
    id: 'struct-C-001',
    description: 'Measurement: concrete compressive strength requirement',
    discipline: 'structural',
    questionClass: 'measurement',
    question: 'What is the required concrete compressive strength (f\'c) for the foundation walls?',
    projectId: null,
    answerContains: ['psi', 'f\'c', 'compressive'],
    answerExcludes: ['I cannot find', 'no data'],
    expectedCitations: [],
    expectedQueryType: 'C',
    guardedRefusalAcceptable: true,  // Acceptable if not in documents
    hallucinationIsCritical: true,
    tags: ['structural', 'measurement', 'concrete'],
    traps: 'Must not fabricate a standard f\'c value (e.g. 3000 psi) if not explicitly stated',
  },
  {
    id: 'struct-D-001',
    description: 'Global: describe the overall structural system',
    discipline: 'structural',
    questionClass: 'global',
    question: 'Describe the overall structural system for this project — what framing type, foundation type, and lateral system are used?',
    projectId: null,
    answerContains: ['foundation', 'structural'],
    answerExcludes: [],
    expectedCitations: [],
    expectedQueryType: 'D',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: false,
    tags: ['structural', 'global', 'scope-summary'],
    traps: 'Must not invent a framing system type not evidenced in documents',
  },
]

// ---------------------------------------------------------------------------
// Architectural
// ---------------------------------------------------------------------------

const ARCHITECTURAL_CASES: EvalTestCase[] = [
  {
    id: 'arch-A-001',
    description: 'Simple retrieval: door schedule lookup for a specific door tag',
    discipline: 'architectural',
    questionClass: 'simple_retrieval',
    question: 'What does the door schedule say for door D-14?',
    projectId: null,
    answerContains: ['D-14'],
    answerExcludes: ['D-13', 'D-15', 'I cannot find'],
    expectedCitations: [],
    expectedQueryType: 'A',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: true,
    tags: ['arch', 'schedule', 'door-lookup'],
    traps: 'Must return D-14 row specifically — not adjacent doors or an interpolated description',
  },
  {
    id: 'arch-B-001',
    description: 'Enumeration: list all rooms on Level 1',
    discipline: 'architectural',
    questionClass: 'enumeration',
    question: 'List all rooms on Level 1 with their room numbers and names.',
    projectId: null,
    answerContains: ['room'],
    answerExcludes: ['level 2', 'roof', 'I cannot find'],
    expectedCitations: [],
    minCitationCount: 1,
    expectedQueryType: 'B',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: false,
    tags: ['arch', 'enumeration', 'rooms'],
    traps: 'Should list rooms from Level 1 only, not bleed into Level 2 data',
  },
  {
    id: 'arch-C-001',
    description: 'Measurement: clear opening width for a specific door',
    discipline: 'architectural',
    questionClass: 'measurement',
    question: 'What is the clear opening width for door D-14?',
    projectId: null,
    answerContains: ['door', 'D-14'],
    answerExcludes: ['I cannot determine', 'no schedule'],
    expectedCitations: [],
    expectedQueryType: 'C',
    guardedRefusalAcceptable: true,  // Acceptable if door not present in project
    hallucinationIsCritical: true,
    tags: ['arch', 'measurement', 'door'],
    traps: 'Must not invent a standard ADA width (e.g. 36") if not documented for this door',
  },
  {
    id: 'arch-D-001',
    description: 'Global: describe all finishes in Room 105',
    discipline: 'architectural',
    questionClass: 'global',
    question: 'What are all the finishes and details for Room 105?',
    projectId: null,
    answerContains: ['room', '105'],
    answerExcludes: ['room 104', 'room 106'],
    expectedCitations: [],
    expectedQueryType: 'D',
    guardedRefusalAcceptable: true,
    hallucinationIsCritical: false,
    tags: ['arch', 'global', 'room-scope'],
    traps: 'Finish data from adjacent rooms must not bleed into Room 105 answer',
  },
]

// ---------------------------------------------------------------------------
// Demolition
// ---------------------------------------------------------------------------

const DEMOLITION_CASES: EvalTestCase[] = [
  {
    id: 'demo-A-001',
    description: 'Simple retrieval: status of a specific element',
    discipline: 'demolition',
    questionClass: 'simple_retrieval',
    question: 'Is the existing mechanical equipment in Room 104 being removed or remaining?',
    projectId: null,
    answerContains: ['room 104', 'mechanical'],
    answerExcludes: ['room 105', 'I cannot find'],
    expectedCitations: [],
    expectedQueryType: 'A',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: true,
    tags: ['demo', 'status-lookup', 'room-specific'],
    traps: 'Must not confuse room 104 with room 105 demolition scope',
  },
  {
    id: 'demo-B-001',
    description: 'Enumeration: list all items to be demolished',
    discipline: 'demolition',
    questionClass: 'enumeration',
    question: 'List all elements scheduled for removal on the demo plans.',
    projectId: null,
    answerContains: ['remove', 'demolish'],
    answerExcludes: ['to remain', 'to protect', 'existing to remain'],
    expectedCitations: [],
    minCitationCount: 1,
    expectedQueryType: 'B',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: false,
    tags: ['demo', 'enumeration', 'removal-list'],
    traps: 'Must not list elements marked "to remain" or "to protect" as being removed',
  },
  {
    id: 'demo-C-001',
    description: 'Measurement: area of slab to be demolished',
    discipline: 'demolition',
    questionClass: 'measurement',
    question: 'How much floor slab area (in SF) is scheduled for demolition?',
    projectId: null,
    answerContains: ['slab', 'demolish'],
    answerExcludes: ['I cannot determine', 'no data'],
    expectedCitations: [],
    expectedQueryType: 'C',
    guardedRefusalAcceptable: true,
    hallucinationIsCritical: true,
    tags: ['demo', 'measurement', 'area'],
    traps: 'Must not fabricate an area quantity — prefer refusal if data is absent',
  },
  {
    id: 'demo-D-001',
    description: 'Global: describe full demolition scope',
    discipline: 'demolition',
    questionClass: 'global',
    question: 'Describe the full demolition scope for this project — what is being removed, what remains, and what needs to be protected?',
    projectId: null,
    answerContains: ['remove', 'remain', 'protect'],
    answerExcludes: [],
    expectedCitations: [],
    expectedQueryType: 'D',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: false,
    tags: ['demo', 'global', 'scope-summary'],
    traps: 'Must cite demo plan sheets; must not fabricate scope categories not shown in documents',
  },
]

// ---------------------------------------------------------------------------
// MEP (Mechanical / Electrical / Plumbing)
// ---------------------------------------------------------------------------

const MEP_CASES: EvalTestCase[] = [
  {
    id: 'mep-A-001',
    description: 'Simple retrieval: panel schedule lookup',
    discipline: 'mep',
    questionClass: 'simple_retrieval',
    question: 'What panel does panel LP-1 feed, and what is its amperage?',
    projectId: null,
    answerContains: ['LP-1', 'panel'],
    answerExcludes: ['LP-2', 'I cannot find'],
    expectedCitations: [],
    expectedQueryType: 'A',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: true,
    tags: ['mep', 'electrical', 'panel-schedule', 'lookup'],
    traps: 'Must return LP-1 data specifically; adjacent panel data must not bleed in',
  },
  {
    id: 'mep-B-001',
    description: 'Enumeration: list all mechanical equipment',
    discipline: 'mep',
    questionClass: 'enumeration',
    question: 'List all air handling units and rooftop units on this project.',
    projectId: null,
    answerContains: ['air', 'unit'],
    answerExcludes: ['plumbing', 'electrical panel', 'I cannot find'],
    expectedCitations: [],
    minCitationCount: 1,
    expectedQueryType: 'B',
    guardedRefusalAcceptable: false,
    hallucinationIsCritical: false,
    tags: ['mep', 'mechanical', 'enumeration', 'equipment'],
    traps: 'Must not mix in plumbing equipment or electrical panels in response',
  },
  {
    id: 'mep-C-001',
    description: 'Measurement: duct size for a specific run',
    discipline: 'mep',
    questionClass: 'measurement',
    question: 'What is the main supply duct size serving Room 105?',
    projectId: null,
    answerContains: ['duct', 'room', '105'],
    answerExcludes: ['I cannot determine', 'no data'],
    expectedCitations: [],
    expectedQueryType: 'C',
    guardedRefusalAcceptable: true,
    hallucinationIsCritical: true,
    tags: ['mep', 'mechanical', 'duct', 'measurement'],
    traps: 'Must not fabricate a duct size; duct sizing from adjacent rooms must not be returned',
  },
  {
    id: 'mep-D-001',
    description: 'Global: describe MEP systems in Room 105',
    discipline: 'mep',
    questionClass: 'global',
    question: 'What MEP systems and equipment are in Room 105?',
    projectId: null,
    answerContains: ['room', '105'],
    answerExcludes: ['room 104', 'room 106'],
    expectedCitations: [],
    expectedQueryType: 'D',
    guardedRefusalAcceptable: true,
    hallucinationIsCritical: false,
    tags: ['mep', 'global', 'coordination', 'room-scope'],
    traps: 'Should cover all three trades (electrical/mechanical/plumbing) if present; must not invent absent systems',
  },
]

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** All 20 baseline benchmark cases. */
export const ALL_CASES: EvalTestCase[] = [
  ...CIVIL_CASES,
  ...STRUCTURAL_CASES,
  ...ARCHITECTURAL_CASES,
  ...DEMOLITION_CASES,
  ...MEP_CASES,
]

/** Look up a case by ID. */
export function getCaseById(id: string): EvalTestCase | undefined {
  return ALL_CASES.find(c => c.id === id)
}

/** Filter cases by discipline. */
export function getCasesByDiscipline(discipline: import('./types').EvalDiscipline): EvalTestCase[] {
  return ALL_CASES.filter(c => c.discipline === discipline)
}

/** Filter cases by question class. */
export function getCasesByClass(cls: import('./types').QuestionClass): EvalTestCase[] {
  return ALL_CASES.filter(c => c.questionClass === cls)
}

/** Filter cases by tag. */
export function getCasesByTag(tag: string): EvalTestCase[] {
  return ALL_CASES.filter(c => c.tags.includes(tag))
}

/** Returns a matrix summary: disciplines × question classes → case count. */
export function getCoverageMatrix(): Record<string, Record<string, number>> {
  const matrix: Record<string, Record<string, number>> = {}
  for (const c of ALL_CASES) {
    if (!matrix[c.discipline]) matrix[c.discipline] = {}
    matrix[c.discipline][c.questionClass] = (matrix[c.discipline][c.questionClass] ?? 0) + 1
  }
  return matrix
}
