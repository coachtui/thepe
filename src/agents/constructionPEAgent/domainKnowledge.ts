/**
 * Construction PE Domain Knowledge
 * 
 * This is the institutional knowledge that separates a green engineer
 * from a seasoned PE. These are the lessons learned from thousands of
 * projects, disputes, and late nights in the field office.
 */

import type { 
  ContractType, 
  WorkType, 
  OwnerType, 
  SpecSection,
  StandardReference 
} from './types';

// ============================================================================
// THE PE'S MENTAL MODELS
// ============================================================================

/**
 * How a PE thinks about different contract types
 */
export const CONTRACT_MINDSET: Record<ContractType, {
  primaryFocus: string;
  documentationPriority: string;
  changeStrategy: string;
  riskMindset: string;
  fieldPriorities: string[];
}> = {
  lump_sum: {
    primaryFocus: "Protect the bid - every extra costs us money",
    documentationPriority: "Document EVERYTHING that differs from bid assumptions",
    changeStrategy: "Aggressive change order recovery - we bid what was shown",
    riskMindset: "Quantity risk is ours - find efficiencies, catch extras",
    fieldPriorities: [
      "Track actual quantities vs bid quantities DAILY",
      "Photo document all differing conditions BEFORE disturbing",
      "RFI anything ambiguous - get owner's interpretation on record",
      "Time-stamp all owner/engineer responses",
      "Maintain contemporaneous cost records for potential claims"
    ]
  },
  unit_price: {
    primaryFocus: "Accurate quantity tracking is everything",
    documentationPriority: "Daily quantity sheets signed by inspector",
    changeStrategy: "New items for work outside bid items, quantity adjustments per contract",
    riskMindset: "Unit prices should cover costs - volume variance is the risk",
    fieldPriorities: [
      "Get inspector sign-off on quantities DAILY",
      "Document measurement methods in writing",
      "Track overruns/underruns for early warning",
      "Challenge any disputed measurements immediately",
      "Photograph challenging measurement situations"
    ]
  },
  time_and_materials: {
    primaryFocus: "Meticulous time and material tracking",
    documentationPriority: "Daily T&M tickets signed by owner rep",
    changeStrategy: "Scope changes just require authorization",
    riskMindset: "Our risk is efficiency - owner pays actuals",
    fieldPriorities: [
      "T&M tickets signed DAILY - never batch",
      "Separate labor, equipment, materials clearly",
      "Include all markup per contract",
      "Photo document material deliveries",
      "Track standby time separately"
    ]
  },
  cost_plus: {
    primaryFocus: "Transparent cost tracking, protect the fee",
    documentationPriority: "Open book accounting, detailed backup",
    changeStrategy: "Scope changes flow through, fee may adjust",
    riskMindset: "Reputation risk - owner sees everything",
    fieldPriorities: [
      "Maintain impeccable cost records",
      "Justify all costs with backup",
      "Track fee-bearing vs non-fee costs",
      "Competitive pricing on major purchases",
      "Document owner-directed decisions"
    ]
  },
  design_build: {
    primaryFocus: "We own the design - coordination is everything",
    documentationPriority: "Owner criteria changes, basis of design",
    changeStrategy: "Owner criteria changes drive changes - not design development",
    riskMindset: "Design risk is ours - catch issues early",
    fieldPriorities: [
      "Rigorous design review before construction",
      "Document owner's criteria precisely",
      "Track all owner-requested changes to criteria",
      "Coordinate aggressively between disciplines",
      "Value engineer continuously"
    ]
  },
  gmp: {
    primaryFocus: "Hit the GMP - savings sharing is our upside",
    documentationPriority: "Track GMP basis, allowances, and contingency burns",
    changeStrategy: "Only owner scope changes increase GMP",
    riskMindset: "Contingency is not profit - earn it through performance",
    fieldPriorities: [
      "Track contingency burns weekly",
      "Document all GMP basis assumptions",
      "Owner changes must be formally documented",
      "Buy out below GMP where possible",
      "Protect savings share through documentation"
    ]
  }
};

/**
 * How to communicate with different owner types
 */
export const OWNER_COMMUNICATION_STYLE: Record<OwnerType, {
  tone: string;
  formalityLevel: string;
  decisionMakers: string;
  painPoints: string[];
  effectiveApproaches: string[];
  thingsToAvoid: string[];
}> = {
  public_municipal: {
    tone: "Professional, respectful of process, patient",
    formalityLevel: "Formal written communication, follow their procedures exactly",
    decisionMakers: "City Engineer, but may need Council approval for changes",
    painPoints: [
      "Political pressure from residents",
      "Budget cycles and funding constraints",
      "Public records requests",
      "Media scrutiny on public spending"
    ],
    effectiveApproaches: [
      "Provide options, not ultimatums",
      "Help them look good to constituents",
      "Be patient with approval processes",
      "Document verbal agreements immediately in writing",
      "Offer to attend public meetings if helpful"
    ],
    thingsToAvoid: [
      "Going over their heads politically",
      "Embarrassing them publicly",
      "Assuming verbal approval is enough",
      "Missing public notice requirements"
    ]
  },
  public_state: {
    tone: "Formal, procedural, by-the-book",
    formalityLevel: "Strict adherence to contract documents and procedures",
    decisionMakers: "Resident Engineer, but District may override",
    painPoints: [
      "Standardized specs that may not fit the situation",
      "Multiple levels of approval",
      "Audit exposure",
      "DBE compliance tracking"
    ],
    effectiveApproaches: [
      "Know their standard specs cold",
      "Use their forms and procedures exactly",
      "Build relationship with Resident Engineer",
      "Document everything assuming future audit",
      "Provide detailed backup for every extra"
    ],
    thingsToAvoid: [
      "Cutting corners on documentation",
      "Assuming flexibility exists",
      "Verbal agreements without written follow-up",
      "Missing DBE reporting deadlines"
    ]
  },
  public_federal: {
    tone: "Extremely formal, compliance-focused",
    formalityLevel: "Maximum formality, legal review of major communications",
    decisionMakers: "Contracting Officer - no one else can bind the government",
    painPoints: [
      "FAR compliance",
      "Davis-Bacon wage requirements",
      "Extensive documentation requirements",
      "Inspector General audits"
    ],
    effectiveApproaches: [
      "Know the FAR clauses in your contract",
      "Certified payrolls must be perfect",
      "Build relationship with COR (Contracting Officer Rep)",
      "Requests for Equitable Adjustment must be thorough",
      "Assume everything will be audited"
    ],
    thingsToAvoid: [
      "ANY communication that could be construed as a claim without proper notice",
      "Wage violations (criminal penalties possible)",
      "Buy American Act violations",
      "Small business subcontracting shortfalls"
    ]
  },
  private_developer: {
    tone: "Direct, solutions-focused, time-is-money",
    formalityLevel: "Less formal but still documented",
    decisionMakers: "Project Manager or Owner's Rep, usually can decide quickly",
    painPoints: [
      "Financing deadlines",
      "Tenant move-in dates",
      "Carrying costs on land",
      "Investor pressure"
    ],
    effectiveApproaches: [
      "Focus on schedule solutions",
      "Offer cost-time tradeoffs",
      "Be responsive - they expect quick answers",
      "Help them hit their milestones",
      "Understand their financial drivers"
    ],
    thingsToAvoid: [
      "Slow responses",
      "Surprises - especially cost surprises",
      "Being inflexible on means and methods",
      "Not understanding their priorities"
    ]
  },
  private_industrial: {
    tone: "Safety-first, technically precise, reliability-focused",
    formalityLevel: "Formal for safety, practical for operations",
    decisionMakers: "Plant Manager for operations, Project Manager for construction",
    painPoints: [
      "Plant downtime costs ($$$)",
      "Safety incidents",
      "Environmental compliance",
      "Process disruptions"
    ],
    effectiveApproaches: [
      "Lead with safety",
      "Understand their operations schedule",
      "Coordinate shutdowns meticulously",
      "Respect their facility rules absolutely",
      "Provide detailed work plans"
    ],
    thingsToAvoid: [
      "ANY safety shortcuts",
      "Surprising them with plant impacts",
      "Underestimating coordination needs",
      "Ignoring their safety requirements"
    ]
  },
  utility_company: {
    tone: "Technical, standards-focused, regulatory-aware",
    formalityLevel: "Formal, especially for franchise work",
    decisionMakers: "Project Engineer, but standards group has veto power",
    painPoints: [
      "PUC/regulatory compliance",
      "Rate case justification",
      "Service reliability requirements",
      "As-built accuracy for GIS"
    ],
    effectiveApproaches: [
      "Know their standards manual",
      "Understand franchise requirements",
      "Provide detailed as-built data",
      "Coordinate outages well in advance",
      "Respect their inspection requirements"
    ],
    thingsToAvoid: [
      "Deviating from standards without approval",
      "Incomplete as-built information",
      "Uncoordinated service interruptions",
      "Ignoring GIS data requirements"
    ]
  }
};

// ============================================================================
// FIELD EXPERIENCE WISDOM
// ============================================================================

/**
 * Work-type specific knowledge that comes from field experience
 */
export const WORK_TYPE_KNOWLEDGE: Record<WorkType, {
  criticalSuccessFactors: string[];
  commonProblems: string[];
  quantityPitfalls: string[];
  inspectionFocus: string[];
  weatherSensitivity: string;
  typicalProductionRates: Record<string, string>;
  submittalsCriticalPath: string[];
}> = {
  utilities_wet: {
    criticalSuccessFactors: [
      "Potholing existing utilities BEFORE you dig",
      "Dewatering plan for high groundwater",
      "Pipe bedding material availability",
      "Pressure/leakage testing preparation",
      "Chlorination and bacteriological clearance timeline"
    ],
    commonProblems: [
      "Unmarked existing utilities",
      "Groundwater higher than borings showed",
      "Bedding material failing gradation",
      "Failed pressure tests",
      "Contaminated groundwater disposal",
      "Trench box logistics in tight ROW"
    ],
    quantityPitfalls: [
      "Trench depth varies - affects excavation, bedding, backfill",
      "Fittings add up - every tee, bend, valve",
      "Service connections often underestimated",
      "Pavement restoration quantities",
      "Import/export calculations from borings vs actual"
    ],
    inspectionFocus: [
      "Bedding compaction",
      "Joint assembly and restraint",
      "Thrust blocking",
      "Pressure test witnessing",
      "Compaction tests at lift intervals",
      "Chlorination procedures"
    ],
    weatherSensitivity: "Moderate - rain affects open trenches, extreme cold affects pipe joining",
    typicalProductionRates: {
      "8-inch water main": "150-250 LF/day depending on depth and conditions",
      "12-inch sewer": "100-200 LF/day depending on depth",
      "48-inch storm drain": "50-100 LF/day",
      "Manhole": "1-2 per day",
      "Fire hydrant assembly": "2-3 per day"
    },
    submittalsCriticalPath: [
      "Pipe and fittings (long lead)",
      "Valves (especially large diameter)",
      "Hydrants",
      "Bedding material source approval",
      "Backfill material source approval",
      "Testing equipment calibration"
    ]
  },
  utilities_dry: {
    criticalSuccessFactors: [
      "Joint trench agreements and coordination",
      "Utility company inspection scheduling",
      "Conduit and cable pulling sequence",
      "Splice vault and handhole placement",
      "Street light foundation coordination"
    ],
    commonProblems: [
      "Utility company schedule changes",
      "Conduit sweeps exceeding cable pulling radius",
      "Joint trench conflicts between utilities",
      "Transformer pad elevations",
      "Telecom provider delays"
    ],
    quantityPitfalls: [
      "Conduit fittings and sweeps",
      "Pull box quantities at direction changes",
      "Conductor footage including slack and terminations",
      "Grounding electrode quantities",
      "Spare conduits often missed"
    ],
    inspectionFocus: [
      "Conduit joints and glue",
      "Minimum cover",
      "Mandrel testing",
      "Pull tape installation",
      "Ground rod installation",
      "Utility company witness points"
    ],
    weatherSensitivity: "Low to moderate - most work can continue in light rain",
    typicalProductionRates: {
      "2-inch conduit bank (4 conduits)": "300-500 LF/day",
      "Primary underground electric": "200-300 LF/day",
      "Street light installation": "2-4 per day",
      "Transformer pad": "1-2 per day"
    },
    submittalsCriticalPath: [
      "Transformers (long lead)",
      "Switchgear",
      "Street light poles and fixtures",
      "Cable and conductor",
      "Telecom equipment"
    ]
  },
  roadwork: {
    criticalSuccessFactors: [
      "Subgrade preparation and proof rolling",
      "Base material source qualification",
      "Paving window weather forecasting",
      "Traffic control and public notification",
      "Striping and signage sequencing"
    ],
    commonProblems: [
      "Soft subgrade areas",
      "Base material variability",
      "Paving temperature requirements",
      "Rain delays during paving operations",
      "Utility conflicts in paving areas",
      "Night work noise complaints"
    ],
    quantityPitfalls: [
      "Subgrade treatment varies significantly",
      "AC thickness variations at tapers and transitions",
      "Striping quantities (detail vs plan scale)",
      "Sign quantities and locations",
      "Curb and gutter radius pieces"
    ],
    inspectionFocus: [
      "Subgrade proof roll",
      "Base compaction and thickness",
      "Tack coat application",
      "AC temperatures and compaction",
      "Grade and cross-slope",
      "Joint construction"
    ],
    weatherSensitivity: "High - paving requires specific temperature windows and dry conditions",
    typicalProductionRates: {
      "Subgrade preparation": "5,000-10,000 SF/day",
      "Aggregate base": "3,000-6,000 SF/day",
      "AC paving": "2,000-4,000 tons/day per paver",
      "Curb and gutter": "300-500 LF/day",
      "Striping": "5,000-15,000 LF/day"
    },
    submittalsCriticalPath: [
      "Aggregate base source approval",
      "AC mix design",
      "Geotextile materials",
      "Traffic signal equipment (if applicable)",
      "Striping materials"
    ]
  },
  earthwork: {
    criticalSuccessFactors: [
      "Material characterization from borings",
      "Moisture conditioning plan",
      "Haul route establishment and maintenance",
      "Erosion control during operations",
      "Survey control for grade"
    ],
    commonProblems: [
      "Material moisture content",
      "Unexpected rock",
      "Unsuitable material quantities",
      "Haul road maintenance",
      "Erosion during rain events",
      "Settlement after completion"
    ],
    quantityPitfalls: [
      "Shrink/swell factors from borings",
      "Stripping depth variations",
      "Unsuitable material extent",
      "Import/export balance errors",
      "Over-excavation for unsuitable"
    ],
    inspectionFocus: [
      "Material classification",
      "Moisture content",
      "Lift thickness",
      "Compaction testing",
      "Grade tolerance",
      "Slope stability"
    ],
    weatherSensitivity: "High - moisture content critical for compaction",
    typicalProductionRates: {
      "Stripping": "2,000-5,000 CY/day",
      "Mass excavation": "3,000-10,000 CY/day",
      "Embankment": "1,500-4,000 CY/day",
      "Fine grading": "5,000-15,000 SF/day"
    },
    submittalsCriticalPath: [
      "Import material source approval",
      "Geotechnical testing lab qualification",
      "Erosion control materials",
      "Compaction equipment"
    ]
  },
  structures: {
    criticalSuccessFactors: [
      "Foundation conditions verification",
      "Formwork and shoring design",
      "Reinforcing steel detailing coordination",
      "Concrete mix design qualification",
      "Curing conditions and timing"
    ],
    commonProblems: [
      "Foundation bearing issues",
      "Reinforcing congestion at joints",
      "Form blowouts",
      "Cold joints",
      "Concrete placement in extreme temperatures",
      "Post-tensioning coordination"
    ],
    quantityPitfalls: [
      "Formwork reuse assumptions",
      "Reinforcing development and lap lengths",
      "Concrete waste factors",
      "Anchor bolt and embed quantities",
      "Architectural finish requirements"
    ],
    inspectionFocus: [
      "Bearing surface preparation",
      "Reinforcing placement and clearances",
      "Form alignment and bracing",
      "Concrete placement and consolidation",
      "Curing procedures",
      "Post-tensioning operations"
    ],
    weatherSensitivity: "Moderate to high - concrete curing sensitive to temperature extremes",
    typicalProductionRates: {
      "Form/pour/strip footings": "50-100 CY/day",
      "Walls": "100-200 SF forms/day",
      "Elevated deck": "1,000-2,000 SF/pour",
      "Reinforcing placement": "2-5 tons/day per ironworker crew"
    },
    submittalsCriticalPath: [
      "Structural steel (long lead)",
      "Reinforcing steel shop drawings",
      "Concrete mix designs",
      "Bearing pads and expansion joints",
      "Post-tensioning system"
    ]
  },
  sitework: {
    criticalSuccessFactors: [
      "Erosion control installation before grading",
      "Utility coordination and sequencing",
      "Storm water management during construction",
      "Material staging area planning",
      "Landscape irrigation coordination"
    ],
    commonProblems: [
      "Erosion control failures",
      "Grade drainage issues",
      "Utility conflicts",
      "Landscape survival",
      "ADA compliance at details"
    ],
    quantityPitfalls: [
      "Fine grading tolerance requirements",
      "Topsoil depth and quality",
      "Irrigation coverage calculations",
      "Pavement marking details",
      "Site furnishing installation details"
    ],
    inspectionFocus: [
      "Erosion control integrity",
      "Subgrade preparation",
      "ADA slopes and landings",
      "Drainage patterns",
      "Landscape planting depth and staking"
    ],
    weatherSensitivity: "Moderate - planting windows, concrete work affected",
    typicalProductionRates: {
      "Site clearing": "0.5-2 acres/day",
      "Fine grading": "5,000-10,000 SF/day",
      "Concrete sidewalk": "500-1,000 SF/day",
      "Landscape planting": "varies widely by type"
    },
    submittalsCriticalPath: [
      "Plant material (availability and growing)",
      "Site furnishings",
      "Irrigation materials",
      "Pavers or specialty surfaces"
    ]
  },
  demolition: {
    criticalSuccessFactors: [
      "Hazmat survey and abatement completion",
      "Utility disconnection verification",
      "Adjacent property protection",
      "Dust and debris control",
      "Salvage coordination"
    ],
    commonProblems: [
      "Undocumented hazmat",
      "Undocumented utilities",
      "Adjacent structure damage",
      "Dust complaints",
      "Vibration damage claims"
    ],
    quantityPitfalls: [
      "Hazmat quantities often underestimated",
      "Foundation and below-grade extent",
      "Disposal classifications",
      "Salvage credits",
      "Site restoration after demo"
    ],
    inspectionFocus: [
      "Hazmat clearances",
      "Utility disconnection verification",
      "Structural monitoring",
      "Dust monitoring",
      "Disposal manifests"
    ],
    weatherSensitivity: "Low to moderate - dust control harder in wind, debris management in rain",
    typicalProductionRates: {
      "Building demo": "varies widely by size and type",
      "Slab removal": "2,000-5,000 SF/day",
      "Foundation removal": "50-200 CY/day",
      "Pavement removal": "5,000-15,000 SF/day"
    },
    submittalsCriticalPath: [
      "Hazmat abatement plan",
      "Demolition plan",
      "Disposal facility approvals",
      "Dust and vibration monitoring plan"
    ]
  },
  concrete: {
    criticalSuccessFactors: [
      "Mix design qualification",
      "Form/shore/strip sequence planning",
      "Reinforcing coordination with embeds",
      "Concrete supply reliability",
      "Curing protocol compliance"
    ],
    commonProblems: [
      "Slump and air variations",
      "Placement delays causing cold joints",
      "Form failures",
      "Finishing timing in varying conditions",
      "Crack control"
    ],
    quantityPitfalls: [
      "Waste factor underestimation",
      "Form liner quantities",
      "Curing compound coverage",
      "Joint sealant quantities",
      "Dowel and tie bar counts"
    ],
    inspectionFocus: [
      "Pre-placement inspection",
      "Slump, air, temperature testing",
      "Placement procedures",
      "Consolidation adequacy",
      "Finishing timing and technique",
      "Curing implementation"
    ],
    weatherSensitivity: "High - both hot and cold weather require special procedures",
    typicalProductionRates: {
      "Flatwork": "3,000-6,000 SF/day",
      "Structural pours": "100-300 CY/day depending on complexity",
      "Tilt-up panels": "2-4 panels/day"
    },
    submittalsCriticalPath: [
      "Mix designs",
      "Admixtures",
      "Curing compounds",
      "Joint materials",
      "Form liner/release agents"
    ]
  },
  environmental: {
    criticalSuccessFactors: [
      "Permit compliance tracking",
      "Monitoring protocol adherence",
      "Chain of custody documentation",
      "Regulatory agency communication",
      "Contingency planning for exceedances"
    ],
    commonProblems: [
      "Unexpected contamination extent",
      "Permit modifications required",
      "Disposal facility capacity",
      "Monitoring exceedances",
      "Schedule impacts from characterization"
    ],
    quantityPitfalls: [
      "Contaminated soil extent",
      "Treatment quantities",
      "Monitoring frequency costs",
      "Disposal classification levels",
      "Confirmation sampling quantities"
    ],
    inspectionFocus: [
      "Sampling procedures",
      "PPE compliance",
      "Containment integrity",
      "Disposal documentation",
      "Air monitoring"
    ],
    weatherSensitivity: "Variable - dewatering affected by rain, dust control in dry weather",
    typicalProductionRates: {
      "Highly variable depending on contamination type and level": "",
      "Soil excavation (contaminated)": "200-1,000 CY/day",
      "Groundwater treatment": "varies by system"
    },
    submittalsCriticalPath: [
      "Remediation work plan",
      "Health and safety plan",
      "Disposal facility approvals",
      "Monitoring equipment calibration"
    ]
  }
};

// ============================================================================
// SPECIFICATION KNOWLEDGE
// ============================================================================

/**
 * Common CSI MasterFormat spec sections for heavy civil work
 */
export const COMMON_SPEC_SECTIONS: SpecSection[] = [
  {
    number: "31 10 00",
    title: "Site Clearing",
    division: 31,
    commonIssues: [
      "Tree protection zone violations",
      "Disposal site limitations",
      "Topsoil stockpile quality",
      "Root ball size requirements"
    ],
    keyRequirements: [
      "Clearing limits staked before work",
      "Topsoil salvage requirements",
      "Disposal documentation",
      "Permit requirements for tree removal"
    ],
    typicalSubmittals: [
      "Tree protection plan",
      "Disposal facility approval",
      "Stockpile locations"
    ]
  },
  {
    number: "31 23 16",
    title: "Excavation",
    division: 31,
    commonIssues: [
      "Unauthorized excavation",
      "Trench safety compliance",
      "Groundwater handling",
      "Utility conflicts"
    ],
    keyRequirements: [
      "Competent person designation",
      "Slope or shoring requirements",
      "Dewatering permits",
      "Utility notification requirements"
    ],
    typicalSubmittals: [
      "Excavation plan",
      "Shoring design",
      "Dewatering plan"
    ]
  },
  {
    number: "31 23 23",
    title: "Fill",
    division: 31,
    commonIssues: [
      "Material quality variations",
      "Moisture content control",
      "Compaction test failures",
      "Lift thickness violations"
    ],
    keyRequirements: [
      "Material gradation requirements",
      "Moisture content limits",
      "Compaction percentage requirements",
      "Lift thickness maximums",
      "Testing frequency"
    ],
    typicalSubmittals: [
      "Material source approval",
      "Compaction test results",
      "Moisture-density relationship curves"
    ]
  },
  {
    number: "32 11 23",
    title: "Aggregate Base Course",
    division: 32,
    commonIssues: [
      "Gradation failures",
      "Segregation during placement",
      "Thickness variations",
      "Subgrade disturbance"
    ],
    keyRequirements: [
      "Gradation requirements per ASTM/AASHTO",
      "Minimum thickness",
      "Compaction requirements",
      "Surface tolerance"
    ],
    typicalSubmittals: [
      "Source approval with test reports",
      "Gradation tests per lot",
      "Compaction test results",
      "Thickness measurements"
    ]
  },
  {
    number: "32 12 16",
    title: "Asphalt Paving",
    division: 32,
    commonIssues: [
      "Mix temperature at placement",
      "Compaction before cooling",
      "Joint construction",
      "Segregation",
      "Weather delays"
    ],
    keyRequirements: [
      "Mix design approval",
      "Temperature requirements",
      "Compaction requirements",
      "Joint offset requirements",
      "Weather limitations"
    ],
    typicalSubmittals: [
      "Mix design with JMF",
      "Binder certifications",
      "Plant tickets",
      "Core test results",
      "Density test results"
    ]
  },
  {
    number: "33 10 00",
    title: "Water Utilities",
    division: 33,
    commonIssues: [
      "Pressure test failures",
      "Bacteriological test failures",
      "Thrust restraint adequacy",
      "Service connection leaks"
    ],
    keyRequirements: [
      "Pressure test requirements",
      "Leakage allowance",
      "Disinfection procedures",
      "Bacteriological clearance",
      "Separation from sewer"
    ],
    typicalSubmittals: [
      "Pipe and fittings",
      "Valves",
      "Hydrants",
      "Bedding material",
      "Test results"
    ]
  },
  {
    number: "33 30 00",
    title: "Sanitary Sewerage",
    division: 33,
    commonIssues: [
      "Line and grade accuracy",
      "Infiltration",
      "Mandrel test failures",
      "Manhole invert construction"
    ],
    keyRequirements: [
      "Minimum slope requirements",
      "Air/water test requirements",
      "Mandrel size requirements",
      "CCTV inspection",
      "Manhole test requirements"
    ],
    typicalSubmittals: [
      "Pipe",
      "Manholes",
      "Testing reports",
      "CCTV inspection logs"
    ]
  },
  {
    number: "33 40 00",
    title: "Storm Drainage",
    division: 33,
    commonIssues: [
      "Inlet placement and grades",
      "Pipe joint infiltration",
      "Energy dissipation adequacy",
      "Outfall erosion"
    ],
    keyRequirements: [
      "Hydraulic capacity requirements",
      "Joint tightness requirements",
      "Outlet protection",
      "Connection to existing systems"
    ],
    typicalSubmittals: [
      "Pipe",
      "Structures",
      "Outlet protection",
      "Testing reports"
    ]
  }
];

// ============================================================================
// PRICING INTELLIGENCE
// ============================================================================

/**
 * Rough order of magnitude costs - PE should always verify current market
 */
export const ROM_UNIT_COSTS: Record<string, {
  lowRange: number;
  highRange: number;
  unit: string;
  factors: string[];
  lastUpdated: string;
}> = {
  // Earthwork
  "mass_excavation": {
    lowRange: 3,
    highRange: 12,
    unit: "CY",
    factors: ["haul distance", "material type", "site access", "disposal requirements"],
    lastUpdated: "2024"
  },
  "trench_excavation_0_6_ft": {
    lowRange: 15,
    highRange: 40,
    unit: "CY",
    factors: ["width", "shoring needs", "groundwater", "existing utilities"],
    lastUpdated: "2024"
  },
  "structural_backfill": {
    lowRange: 25,
    highRange: 50,
    unit: "CY",
    factors: ["material specification", "compaction requirements", "lift thickness"],
    lastUpdated: "2024"
  },
  "import_fill": {
    lowRange: 20,
    highRange: 45,
    unit: "CY",
    factors: ["haul distance", "material type", "compaction included"],
    lastUpdated: "2024"
  },
  
  // Utilities
  "8_inch_water_main_di": {
    lowRange: 75,
    highRange: 150,
    unit: "LF",
    factors: ["depth", "fittings frequency", "restoration", "urban vs rural"],
    lastUpdated: "2024"
  },
  "12_inch_water_main_di": {
    lowRange: 95,
    highRange: 200,
    unit: "LF",
    factors: ["depth", "fittings frequency", "restoration", "urban vs rural"],
    lastUpdated: "2024"
  },
  "8_inch_sewer_pvc": {
    lowRange: 80,
    highRange: 180,
    unit: "LF",
    factors: ["depth", "groundwater", "bypass pumping", "service connections"],
    lastUpdated: "2024"
  },
  "48_inch_manhole": {
    lowRange: 3500,
    highRange: 8000,
    unit: "EA",
    factors: ["depth", "frame type", "drop connections", "lining requirements"],
    lastUpdated: "2024"
  },
  "fire_hydrant_assembly": {
    lowRange: 4500,
    highRange: 9000,
    unit: "EA",
    factors: ["depth to main", "bury depth", "auxiliary valve requirement"],
    lastUpdated: "2024"
  },
  "gate_valve_8_inch": {
    lowRange: 1800,
    highRange: 3500,
    unit: "EA",
    factors: ["bury depth", "valve box type", "access requirements"],
    lastUpdated: "2024"
  },
  "gate_valve_12_inch": {
    lowRange: 2800,
    highRange: 5500,
    unit: "EA",
    factors: ["bury depth", "valve box type", "access requirements"],
    lastUpdated: "2024"
  },
  
  // Paving
  "aggregate_base_6_inch": {
    lowRange: 3,
    highRange: 7,
    unit: "SF",
    factors: ["material source", "access", "area size"],
    lastUpdated: "2024"
  },
  "asphalt_concrete_2_inch": {
    lowRange: 3,
    highRange: 8,
    unit: "SF",
    factors: ["mix type", "mobilization", "quantity breaks"],
    lastUpdated: "2024"
  },
  "asphalt_concrete_4_inch": {
    lowRange: 5,
    highRange: 12,
    unit: "SF",
    factors: ["mix type", "mobilization", "quantity breaks"],
    lastUpdated: "2024"
  },
  "concrete_curb_and_gutter": {
    lowRange: 25,
    highRange: 55,
    unit: "LF",
    factors: ["type", "forming complexity", "quantity"],
    lastUpdated: "2024"
  },
  "concrete_sidewalk_4_inch": {
    lowRange: 8,
    highRange: 18,
    unit: "SF",
    factors: ["forming complexity", "finish requirements", "accessibility details"],
    lastUpdated: "2024"
  },
  
  // Concrete
  "structural_concrete_4000_psi": {
    lowRange: 800,
    highRange: 1800,
    unit: "CY",
    factors: ["placement method", "forming complexity", "reinforcing density", "finish"],
    lastUpdated: "2024"
  },
  "reinforcing_steel_in_place": {
    lowRange: 1.20,
    highRange: 2.00,
    unit: "LB",
    factors: ["complexity", "bar sizes", "congestion", "project size"],
    lastUpdated: "2024"
  }
};

// ============================================================================
// COMMUNICATION TEMPLATES
// ============================================================================

export const RFI_BEST_PRACTICES = {
  essentialElements: [
    "Clear, specific subject line",
    "Reference to specific drawing/spec/location",
    "Clear statement of the question or conflict",
    "Impact if not resolved (cost/schedule)",
    "Contractor's suggested resolution (if applicable)",
    "Required response date with justification"
  ],
  commonMistakes: [
    "Vague questions that allow evasive answers",
    "Multiple unrelated questions in one RFI",
    "Missing drawing/spec references",
    "Not stating the cost/schedule impact",
    "Not requesting written response",
    "Not following up on non-responses"
  ],
  strategicConsiderations: [
    "RFIs create a record - choose words carefully",
    "Engineer's response may be used against us later",
    "Time-sensitive RFIs need phone follow-up",
    "Consider if this should be an RFI or a change notice",
    "Track response time for potential delay claims"
  ]
};

export const CHANGE_ORDER_STRATEGY = {
  documentation_requirements: [
    "Directive or authorization (written preferred)",
    "Contemporaneous labor records",
    "Equipment logs with hours",
    "Material invoices and delivery tickets",
    "Productivity impact documentation",
    "Schedule impact analysis",
    "Photos before, during, after"
  ],
  pricing_approaches: {
    "negotiated": "Preferred - agree on price before work",
    "time_and_material": "When scope unclear - get signed tickets",
    "unit_price": "When quantities uncertain but unit cost agreed",
    "force_account": "Owner's right to direct - document everything"
  },
  common_recovery_items: [
    "Extended general conditions",
    "Escalation (if contract allows)",
    "Lost productivity (measured mile, industry studies)",
    "Idle equipment",
    "Remobilization",
    "Additional supervision",
    "Bond premium on added work",
    "Insurance premium on added work",
    "Home office overhead (Eichleay if applicable)"
  ]
};
