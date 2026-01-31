#!/usr/bin/env tsx
/**
 * Vision Standards Validator
 *
 * Validates that code follows the standards defined in docs/plans/VISION-AI.md
 *
 * Run: npx tsx scripts/validate-vision-standards.ts
 */

import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

interface ValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  info: string[];
}

const result: ValidationResult = {
  passed: true,
  errors: [],
  warnings: [],
  info: []
};

// =============================================================================
// VALIDATION RULES (Reference: VISION-AI.md)
// =============================================================================

/**
 * Rule 1: Check that DEFAULT_VISION_MODEL is Haiku 4.5
 * Reference: VISION-AI.md - "ALWAYS use Haiku 4.5 as default"
 */
async function validateDefaultModel(): Promise<void> {
  console.log('\n[Rule 1] Validating default model is Haiku 4.5...');

  const files = await glob('src/lib/vision/**/*.ts');

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    // Check for hardcoded Opus usage
    if (content.includes('claude-opus-4')) {
      result.passed = false;
      result.errors.push(`❌ ${file}: NEVER use Opus model (too expensive)`);
    }

    // Warn on Sonnet usage without justification
    if (content.includes('claude-sonnet-4') && !content.includes('complex')) {
      result.warnings.push(
        `⚠️ ${file}: Using Sonnet without "complex" justification. Ensure this is necessary.`
      );
    }

    // Check for proper default
    if (content.includes('selectModelForTask') || content.includes('DEFAULT_VISION_MODEL')) {
      if (!content.includes('claude-haiku-4-5-20251001')) {
        result.errors.push(`❌ ${file}: Default model must be Haiku 4.5`);
        result.passed = false;
      } else {
        result.info.push(`✓ ${file}: Correctly uses Haiku 4.5 as default`);
      }
    }
  }
}

/**
 * Rule 2: Check that confidence scores are always captured
 * Reference: VISION-AI.md - "Extract confidence scores for everything"
 */
async function validateConfidenceScores(): Promise<void> {
  console.log('\n[Rule 2] Validating confidence scores are captured...');

  const files = await glob('src/lib/{vision,chat}/**/*.ts');

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    // Check for quantity/termination extractions without confidence
    if (content.includes('quantities') || content.includes('terminationPoints')) {
      if (!content.includes('confidence')) {
        result.warnings.push(
          `⚠️ ${file}: Extractions found but no confidence field. Verify confidence is captured.`
        );
      }
    }

    // Check for database inserts without confidence
    if (content.includes('.insert(') && (
      content.includes('project_quantities') ||
      content.includes('utility_termination_points')
    )) {
      if (!content.includes('confidence:')) {
        result.errors.push(
          `❌ ${file}: Database insert without confidence field. Required by VISION-AI.md standards.`
        );
        result.passed = false;
      }
    }
  }
}

/**
 * Rule 3: Check priority order in smart quantity handler
 * Reference: VISION-AI.md - "Priority 1: Termination points, Priority 2: Quantities"
 */
async function validatePriorityOrder(): Promise<void> {
  console.log('\n[Rule 3] Validating priority-based resolution order...');

  const handlerFile = 'src/lib/chat/smart-quantity-handler.ts';

  if (!fs.existsSync(handlerFile)) {
    result.warnings.push(`⚠️ ${handlerFile} not found. Skipping priority check.`);
    return;
  }

  const content = fs.readFileSync(handlerFile, 'utf-8');

  // Check that termination points come before quantities
  const terminationIndex = content.indexOf('calculateLengthFromTerminations');
  const quantitiesIndex = content.indexOf('getQuantityDirectly');

  if (terminationIndex === -1 || quantitiesIndex === -1) {
    result.warnings.push(
      `⚠️ ${handlerFile}: Could not find priority checks. Verify manually.`
    );
  } else if (terminationIndex > quantitiesIndex) {
    result.errors.push(
      `❌ ${handlerFile}: WRONG PRIORITY ORDER! Termination points must be checked BEFORE quantities.`
    );
    result.passed = false;
  } else {
    result.info.push(
      `✓ ${handlerFile}: Correct priority order (termination points → quantities)`
    );
  }

  // Check for PRIORITY comments
  if (!content.includes('PRIORITY 1')) {
    result.warnings.push(
      `⚠️ ${handlerFile}: Missing PRIORITY comments. Add for clarity.`
    );
  }
}

/**
 * Rule 4: Check that index sheets are flagged
 * Reference: VISION-AI.md - "Flag index sheets (less reliable)"
 */
async function validateIndexSheetDetection(): Promise<void> {
  console.log('\n[Rule 4] Validating index sheet detection...');

  const files = await glob('src/lib/**/*.ts');

  let foundIndexDetection = false;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    if (content.includes('isIndexSheet') || content.includes('index_list')) {
      foundIndexDetection = true;
      result.info.push(`✓ ${file}: Index sheet detection implemented`);
    }

    // Check for index warnings
    if (content.includes('index') && content.includes('incomplete')) {
      result.info.push(`✓ ${file}: Index sheet warnings present`);
    }
  }

  if (!foundIndexDetection) {
    result.warnings.push(
      `⚠️ No index sheet detection found. Reference VISION-AI.md for implementation.`
    );
  }
}

/**
 * Rule 5: Check that costs are tracked
 * Reference: VISION-AI.md - "Always track costs in database"
 */
async function validateCostTracking(): Promise<void> {
  console.log('\n[Rule 5] Validating cost tracking...');

  const files = await glob('src/lib/vision/**/*.ts');

  let foundCostTracking = false;

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    if (content.includes('vision_cost_usd') || content.includes('estimateCost')) {
      foundCostTracking = true;
      result.info.push(`✓ ${file}: Cost tracking implemented`);
    }

    // Check for model logging
    if (content.includes('Claude Vision') && !content.includes('console.log')) {
      result.warnings.push(
        `⚠️ ${file}: Vision API call without logging. Add model/cost logging per VISION-AI.md.`
      );
    }
  }

  if (!foundCostTracking) {
    result.errors.push(
      `❌ No cost tracking found. REQUIRED by VISION-AI.md - Section 9: Cost Management`
    );
    result.passed = false;
  }
}

/**
 * Rule 6: Check image settings compliance
 * Reference: VISION-AI.md - "Max 2048px, scale 2.0 recommended"
 */
async function validateImageSettings(): Promise<void> {
  console.log('\n[Rule 6] Validating image settings...');

  const pdfImageFile = 'src/lib/vision/pdf-to-image.ts';

  if (!fs.existsSync(pdfImageFile)) {
    result.warnings.push(`⚠️ ${pdfImageFile} not found. Skipping image settings check.`);
    return;
  }

  const content = fs.readFileSync(pdfImageFile, 'utf-8');

  // Check for max dimension
  if (!content.includes('2048')) {
    result.warnings.push(
      `⚠️ ${pdfImageFile}: Max dimension should be 2048px per VISION-AI.md`
    );
  }

  // Check for scale settings
  if (content.includes('scale') && content.includes('3.0')) {
    result.warnings.push(
      `⚠️ ${pdfImageFile}: Scale 3.0 may increase costs. Recommended: 2.0 per VISION-AI.md`
    );
  }

  result.info.push(`✓ ${pdfImageFile}: Image settings validated`);
}

/**
 * Rule 7: Check for constants usage
 * Reference: constants.ts - Should be imported, not hardcoded
 */
async function validateConstantsUsage(): Promise<void> {
  console.log('\n[Rule 7] Validating constants are imported from constants.ts...');

  const files = await glob('src/lib/**/*.ts', {
    ignore: ['**/constants.ts']
  });

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');

    // Check for hardcoded model strings (should use constants)
    if (content.match(/'claude-(haiku|sonnet|opus)-[0-9]/) &&
        !content.includes('from') &&
        !content.includes('@/lib/vision/constants')) {
      result.warnings.push(
        `⚠️ ${file}: Hardcoded model string. Import from '@/lib/vision/constants' instead.`
      );
    }

    // Check for magic numbers that should be constants
    if (content.includes('0.95') || content.includes('0.85') || content.includes('0.70')) {
      if (!content.includes('CONFIDENCE_THRESHOLDS') && !file.includes('constants.ts')) {
        result.warnings.push(
          `⚠️ ${file}: Hardcoded confidence threshold. Use CONFIDENCE_THRESHOLDS from constants.`
        );
      }
    }
  }
}

// =============================================================================
// RUN VALIDATION
// =============================================================================

async function runValidation(): Promise<void> {
  console.log('='.repeat(70));
  console.log('VISION AI STANDARDS VALIDATION');
  console.log('Reference: docs/plans/VISION-AI.md');
  console.log('='.repeat(70));

  // Check that VISION-AI.md exists
  const visionAiDoc = 'docs/plans/VISION-AI.md';
  if (!fs.existsSync(visionAiDoc)) {
    console.error(`\n❌ ERROR: ${visionAiDoc} not found!`);
    console.error('This is the source of truth for Vision AI standards.');
    process.exit(1);
  }

  result.info.push(`✓ Source of truth found: ${visionAiDoc}`);

  // Run all validation rules
  await validateDefaultModel();
  await validateConfidenceScores();
  await validatePriorityOrder();
  await validateIndexSheetDetection();
  await validateCostTracking();
  await validateImageSettings();
  await validateConstantsUsage();

  // Print results
  console.log('\n' + '='.repeat(70));
  console.log('VALIDATION RESULTS');
  console.log('='.repeat(70));

  if (result.info.length > 0) {
    console.log('\n✓ PASSED CHECKS:');
    result.info.forEach(msg => console.log(`  ${msg}`));
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  WARNINGS:');
    result.warnings.forEach(msg => console.log(`  ${msg}`));
  }

  if (result.errors.length > 0) {
    console.log('\n❌ ERRORS:');
    result.errors.forEach(msg => console.log(`  ${msg}`));
  }

  console.log('\n' + '='.repeat(70));

  if (result.passed) {
    console.log('✅ VALIDATION PASSED');
    console.log('Code complies with VISION-AI.md standards.');
    process.exit(0);
  } else {
    console.log('❌ VALIDATION FAILED');
    console.log(`Found ${result.errors.length} error(s) that must be fixed.`);
    console.log('Reference: docs/plans/VISION-AI.md for standards.');
    process.exit(1);
  }
}

// Run validation
runValidation().catch(error => {
  console.error('Validation script error:', error);
  process.exit(1);
});
