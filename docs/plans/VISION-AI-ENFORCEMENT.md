# Vision AI Standards Enforcement System

> **Purpose:** Ensure [VISION-AI.md](./VISION-AI.md) remains the immutable source of truth
> **Status:** Active
> **Last Updated:** 2026-01-29

---

## Overview

This document describes the multi-layered enforcement system that ensures **VISION-AI.md** standards are automatically followed throughout the project.

### Goals

1. ✅ Make VISION-AI.md the **single source of truth** for vision implementation
2. ✅ **Automatically reference** VISION-AI.md when AI works on vision code
3. ✅ **Prevent** violations through pre-commit validation
4. ✅ **Extract** standards into importable constants
5. ✅ **Protect** critical documentation from accidental changes

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    VISION-AI.md (Source of Truth)                │
│                     docs/plans/VISION-AI.md                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Extracted into
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Importable Constants                         │
│                  src/lib/vision/constants.ts                     │
│  • Model IDs          • Confidence thresholds                    │
│  • Cost targets       • Sheet types                              │
│  • Priority levels    • Warning messages                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Used by
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Vision Implementation                        │
│              src/lib/vision/**/*.ts                              │
│              src/lib/chat/smart-*.ts                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Validated by
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Validation Script                             │
│             scripts/validate-vision-standards.ts                 │
│  • Model selection     • Confidence scores                       │
│  • Priority order      • Cost tracking                           │
│  • Constants usage     • Image settings                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Triggered by
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Pre-commit Hook                              │
│                  .husky/pre-commit                               │
│  • Auto-runs validation on vision file changes                   │
│  • Warns when VISION-AI.md is modified                           │
│  • Blocks commit if validation fails                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Protected by
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Git Protection                                │
│         .github/CODEOWNERS + .gitattributes                      │
│  • Requires review for VISION-AI.md changes                      │
│  • Highlights documentation changes in PRs                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Auto-referenced by
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AI Auto-Reference                             │
│                  .claude/context.md                              │
│  • Claude Code automatically reads VISION-AI.md                  │
│  • Triggered by vision-related keywords                          │
│  • Enforces standards during AI assistance                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Details

### 1. Source of Truth: VISION-AI.md

**Location:** `docs/plans/VISION-AI.md`

**Purpose:** Comprehensive technical reference for all Vision AI implementation

**Contains:**
- Model selection strategy (always Haiku 4.5)
- Priority-based data resolution (termination points → quantities → vector search)
- Prompt engineering standards
- Database schema documentation
- Cost management guidelines
- Quality assurance checklists
- Best practices and anti-patterns

**Protection:**
- Listed in CODEOWNERS (requires review)
- Marked as documentation in .gitattributes
- Pre-commit hook warns on modification

---

### 2. Extracted Constants

**Location:** `src/lib/vision/constants.ts`

**Purpose:** Importable TypeScript constants derived from VISION-AI.md

**Exports:**
```typescript
// Models
VISION_MODELS.HAIKU_4_5 = 'claude-haiku-4-5-20251001'
DEFAULT_VISION_MODEL = VISION_MODELS.HAIKU_4_5

// Confidence thresholds
CONFIDENCE_THRESHOLDS.EXCELLENT = 0.95
CONFIDENCE_THRESHOLDS.GOOD = 0.85
CONFIDENCE_THRESHOLDS.FAIR = 0.70

// Priority levels
DATA_SOURCE_PRIORITY.TERMINATION_POINTS = { priority: 1, confidence: 0.95 }
DATA_SOURCE_PRIORITY.STRUCTURED_QUANTITY = { priority: 2, confidence: 0.85 }

// Cost targets
COST_TARGETS.MEDIUM = { maxSheets: 50, targetCostUsd: 1.00 }

// And more...
```

**Usage:**
```typescript
import {
  DEFAULT_VISION_MODEL,
  CONFIDENCE_THRESHOLDS,
  validateModelSelection
} from '@/lib/vision/constants';

// Use constants instead of hardcoding
const model = DEFAULT_VISION_MODEL;  // ✅ Good
const model = 'claude-haiku-4-5';    // ❌ Bad - hardcoded

// Validate confidence
if (confidence >= CONFIDENCE_THRESHOLDS.GOOD) {
  // Use data with confidence
}
```

---

### 3. Validation Script

**Location:** `scripts/validate-vision-standards.ts`

**Purpose:** Automated validation that code follows VISION-AI.md standards

**Checks:**

| Rule | Check | Violation |
|------|-------|-----------|
| 1 | Default model is Haiku 4.5 | Using Sonnet/Opus without justification |
| 2 | Confidence scores captured | Missing confidence fields |
| 3 | Priority order correct | Termination points not checked first |
| 4 | Index sheets flagged | No index detection logic |
| 5 | Costs tracked | Missing cost tracking |
| 6 | Image settings compliant | Wrong dimensions/scale |
| 7 | Constants imported | Hardcoded values instead of imports |

**Run manually:**
```bash
npx tsx scripts/validate-vision-standards.ts
```

**Output:**
```
✓ PASSED CHECKS:
  ✓ src/lib/vision/claude-vision.ts: Correctly uses Haiku 4.5 as default
  ✓ src/lib/chat/smart-quantity-handler.ts: Correct priority order

⚠️  WARNINGS:
  ⚠️ src/lib/vision/pdf-to-image.ts: Scale 3.0 may increase costs

❌ ERRORS:
  ❌ src/lib/chat/quantity-retrieval.ts: Database insert without confidence

✅ VALIDATION PASSED (with warnings)
```

---

### 4. Pre-commit Hook

**Location:** `.husky/pre-commit`

**Purpose:** Automatically validate vision code before commits

**Triggers:**
- Vision-related files modified (`src/lib/vision/**`, `src/lib/chat/**`)
- Runs validation script
- Blocks commit if validation fails

**Behavior:**
```bash
# When vision files are in commit:
git add src/lib/vision/claude-vision.ts
git commit -m "Update vision processing"

# Hook runs:
🔍 Checking for Vision AI standards compliance...
📋 Vision-related files detected in commit:
  - src/lib/vision/claude-vision.ts

⚠️  Running Vision AI standards validation...
✅ Vision AI standards validation PASSED
✅ Pre-commit checks passed
```

**If VISION-AI.md modified:**
```bash
git add docs/plans/VISION-AI.md
git commit -m "Update vision standards"

# Hook warns:
⚠️  WARNING: You are modifying VISION-AI.md
This is the SOURCE OF TRUTH for Vision AI implementation.

After committing:
  1. Update src/lib/vision/constants.ts if needed
  2. Run: npx tsx scripts/validate-vision-standards.ts
  3. Update related code to match new standards

Continue with commit? (y/n)
```

**Bypass (NOT RECOMMENDED):**
```bash
git commit --no-verify
```

---

### 5. Git Protection

#### CODEOWNERS (`.github/CODEOWNERS`)

**Purpose:** Require review for critical files

```
# Vision AI Standards - SOURCE OF TRUTH
/docs/plans/VISION-AI.md @yourusername
/src/lib/vision/constants.ts @yourusername
```

**Effect:**
- GitHub/GitLab requires owner approval for PR
- Prevents accidental changes
- Ensures standards changes are reviewed

#### Git Attributes (`.gitattributes`)

**Purpose:** Mark files as special documentation

```
docs/plans/VISION-AI.md text linguist-documentation
src/lib/vision/constants.ts text linguist-generated=false
```

**Effect:**
- Documentation changes highlighted in PRs
- Constants not marked as auto-generated
- Better diff display

---

### 6. AI Auto-Reference

**Location:** `.claude/context.md`

**Purpose:** Claude Code automatically references VISION-AI.md

**Triggers:**
When user mentions or you detect:
- "vision", "Claude Vision API", "vision processing"
- "model selection", "Haiku", "Sonnet"
- "termination points", "BEGIN/END"
- "quantity extraction", "construction plans"
- "cost optimization", "confidence scores"

**Behavior:**
```
User: "Update the vision processing to use a different model"

Claude Code (automatically):
1. Reads docs/plans/VISION-AI.md
2. Checks current model selection strategy
3. References: "Per VISION-AI.md, default must be Haiku 4.5"
4. Suggests changes compliant with standards
```

**Standards Enforced:**
- ✅ Always use Haiku 4.5 as default
- ✅ Maintain priority order
- ✅ Track confidence scores and costs
- ✅ Use constants from constants.ts
- ❌ Never use Opus
- ❌ Don't skip validation

---

## Setup Instructions

### Initial Setup

1. **Run setup script:**
```bash
chmod +x scripts/setup-vision-standards.sh
./scripts/setup-vision-standards.sh
```

This will:
- Install husky for git hooks
- Configure pre-commit hook
- Run initial validation
- Verify all components

2. **Update CODEOWNERS:**
```bash
# Edit .github/CODEOWNERS
# Replace @yourusername with actual GitHub username
```

3. **Test the system:**
```bash
# Make a change to vision file
echo "// test" >> src/lib/vision/claude-vision.ts

# Try to commit (should trigger validation)
git add src/lib/vision/claude-vision.ts
git commit -m "Test commit"

# Validation should run automatically
```

### Manual Validation

**Run anytime:**
```bash
npx tsx scripts/validate-vision-standards.ts
```

**In CI/CD:**
```yaml
# .github/workflows/ci.yml
- name: Validate Vision Standards
  run: npx tsx scripts/validate-vision-standards.ts
```

---

## Workflow Examples

### Scenario 1: Adding New Vision Feature

```bash
# 1. Start work
git checkout -b feature/new-vision-extraction

# 2. Read standards
open docs/plans/VISION-AI.md

# 3. Import constants
# In your code:
import { DEFAULT_VISION_MODEL, CONFIDENCE_THRESHOLDS } from '@/lib/vision/constants';

# 4. Implement feature
# ... coding ...

# 5. Validate
npx tsx scripts/validate-vision-standards.ts

# 6. Commit (hook auto-validates)
git add src/lib/vision/new-feature.ts
git commit -m "Add new vision extraction feature"

# Pre-commit hook runs automatically ✅
```

### Scenario 2: Updating VISION-AI.md

```bash
# 1. Modify documentation
# Edit docs/plans/VISION-AI.md

# 2. Update constants if needed
# Edit src/lib/vision/constants.ts

# 3. Commit (hook warns)
git add docs/plans/VISION-AI.md src/lib/vision/constants.ts
git commit -m "Update vision standards"

# Hook prompts for confirmation:
# "Continue with commit? (y/n)"

# 4. Update dependent code
# Review and update:
# - src/lib/vision/**/*.ts
# - src/lib/chat/smart-*.ts

# 5. Validate
npx tsx scripts/validate-vision-standards.ts

# 6. Commit updates
git add .
git commit -m "Update code to match new standards"
```

### Scenario 3: Using Claude Code

```
You: "Help me improve the vision processing performance"

Claude Code (automatically):
1. Reads .claude/context.md (sees vision trigger)
2. Reads docs/plans/VISION-AI.md
3. References current standards

Claude: "I see you want to improve vision processing. According to
VISION-AI.md, the current model is Haiku 4.5 (87% cheaper than Sonnet).
For performance improvements, I recommend:
1. Optimize image scale (currently 2.0, per standards)
2. Selective sheet processing (only critical sheets)
3. Parallel processing where possible

All changes will use constants from constants.ts and maintain
the priority order: termination points → quantities → vector search.

Let me help you implement these improvements..."
```

---

## Maintenance

### When VISION-AI.md Changes

**Checklist:**
- [ ] Update `src/lib/vision/constants.ts` if constants changed
- [ ] Update `scripts/validate-vision-standards.ts` if new rules added
- [ ] Run validation: `npx tsx scripts/validate-vision-standards.ts`
- [ ] Update dependent code to match new standards
- [ ] Update HANDOFF.md if major changes
- [ ] Commit with clear description of changes

### When Adding New Validation Rules

**Add to:** `scripts/validate-vision-standards.ts`

```typescript
async function validateNewRule(): Promise<void> {
  console.log('\n[Rule X] Validating new requirement...');

  // Implementation

  if (violation) {
    result.errors.push('Error message with VISION-AI.md reference');
    result.passed = false;
  }
}

// Add to runValidation():
await validateNewRule();
```

### Periodic Audits

**Monthly:**
```bash
# Check compliance across codebase
npx tsx scripts/validate-vision-standards.ts

# Review costs
psql -d pe -c "
  SELECT
    DATE_TRUNC('month', vision_processed_at) as month,
    SUM(vision_cost_usd) as total_cost,
    AVG(vision_cost_usd) as avg_cost
  FROM documents
  WHERE vision_processed_at >= NOW() - INTERVAL '3 months'
  GROUP BY month;
"

# Check model usage
grep -r "claude-sonnet-4" src/lib/vision/
# Should be minimal/none
```

---

## Troubleshooting

### Validation Failing

**Issue:** Pre-commit hook blocks commit

**Solution:**
```bash
# See specific errors
npx tsx scripts/validate-vision-standards.ts

# Fix errors
# Reference docs/plans/VISION-AI.md for standards

# Re-commit
git commit
```

### Constants Out of Sync

**Issue:** Warning: "Hardcoded value instead of constant"

**Solution:**
```typescript
// ❌ Bad
const confidence = 0.95;

// ✅ Good
import { CONFIDENCE_THRESHOLDS } from '@/lib/vision/constants';
const confidence = CONFIDENCE_THRESHOLDS.EXCELLENT;
```

### Hook Not Running

**Issue:** Pre-commit hook doesn't execute

**Solution:**
```bash
# Ensure hook is executable
chmod +x .husky/pre-commit

# Verify husky installed
ls -la .husky/

# Reinstall if needed
npm install --save-dev husky
npx husky install
```

### CODEOWNERS Not Working

**Issue:** PRs don't require review for VISION-AI.md

**Solution:**
```bash
# Ensure file exists
cat .github/CODEOWNERS

# Update username
# Replace @yourusername with actual GitHub username

# Enable in GitHub:
# Settings → Branches → Branch protection rules
# → "Require review from Code Owners"
```

---

## Summary

### Protection Layers

| Layer | File | Purpose | Strength |
|-------|------|---------|----------|
| Documentation | VISION-AI.md | Source of truth | ⭐⭐⭐⭐⭐ |
| Constants | constants.ts | Importable values | ⭐⭐⭐⭐ |
| Validation | validate-vision-standards.ts | Automated checking | ⭐⭐⭐⭐⭐ |
| Pre-commit | .husky/pre-commit | Prevent violations | ⭐⭐⭐⭐⭐ |
| Git Protection | CODEOWNERS | Require review | ⭐⭐⭐⭐ |
| AI Context | .claude/context.md | Auto-reference | ⭐⭐⭐⭐ |

### Key Benefits

✅ **Single Source of Truth** - VISION-AI.md is definitive
✅ **Automatic Validation** - Violations caught before commit
✅ **AI Aware** - Claude Code automatically references standards
✅ **Type Safe** - TypeScript constants prevent typos
✅ **Review Required** - Critical changes need approval
✅ **Easy Maintenance** - Clear process for updates

---

## References

- [VISION-AI.md](./VISION-AI.md) - Technical reference (SOURCE OF TRUTH)
- [HANDOFF.md](../HANDOFF.md) - Current project status
- [MASTER-PLAN.md](./MASTER-PLAN-construction-copilot.md) - Overall architecture

---

**Last Updated:** 2026-01-29
**Maintained By:** Development Team
**Status:** Active - System operational
