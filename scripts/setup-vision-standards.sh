#!/bin/bash
# Setup Vision AI Standards Enforcement
#
# This script sets up git hooks and validation to enforce VISION-AI.md standards

set -e

echo "=================================================="
echo "Vision AI Standards Enforcement Setup"
echo "=================================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if in project root
if [ ! -f "package.json" ]; then
  echo -e "${RED}Error: Must run from project root${NC}"
  exit 1
fi

echo "✓ Project root detected"

# Check if VISION-AI.md exists
if [ ! -f "docs/plans/VISION-AI.md" ]; then
  echo -e "${RED}Error: docs/plans/VISION-AI.md not found${NC}"
  echo "This is the source of truth for Vision AI standards."
  exit 1
fi

echo "✓ VISION-AI.md found (source of truth)"

# Install husky if not already installed
if [ ! -d ".husky" ]; then
  echo ""
  echo "📦 Installing husky for git hooks..."
  npm install --save-dev husky
  npx husky install
  echo "✓ Husky installed"
else
  echo "✓ Husky already installed"
fi

# Make pre-commit hook executable
if [ -f ".husky/pre-commit" ]; then
  chmod +x .husky/pre-commit
  echo "✓ Pre-commit hook configured"
fi

# Verify validation script exists
if [ ! -f "scripts/validate-vision-standards.ts" ]; then
  echo -e "${RED}Error: scripts/validate-vision-standards.ts not found${NC}"
  exit 1
fi

echo "✓ Validation script found"

# Verify constants file exists
if [ ! -f "src/lib/vision/constants.ts" ]; then
  echo -e "${YELLOW}Warning: src/lib/vision/constants.ts not found${NC}"
  echo "This file should contain constants extracted from VISION-AI.md"
else
  echo "✓ Constants file found"
fi

# Run initial validation
echo ""
echo "=================================================="
echo "Running Initial Validation"
echo "=================================================="
echo ""

npx tsx scripts/validate-vision-standards.ts

VALIDATION_EXIT=$?

echo ""
echo "=================================================="
echo "Setup Complete"
echo "=================================================="
echo ""

if [ $VALIDATION_EXIT -eq 0 ]; then
  echo -e "${GREEN}✅ All systems operational${NC}"
  echo ""
  echo "Vision AI standards enforcement is now active:"
  echo "  • Pre-commit hooks will validate vision code"
  echo "  • VISION-AI.md is protected via CODEOWNERS"
  echo "  • Constants must be imported from constants.ts"
  echo "  • Claude Code will auto-reference VISION-AI.md"
  echo ""
  echo "To manually validate at any time:"
  echo "  npx tsx scripts/validate-vision-standards.ts"
else
  echo -e "${YELLOW}⚠️  Setup complete but validation found issues${NC}"
  echo ""
  echo "Fix the issues above before committing vision-related code."
  echo "Reference: docs/plans/VISION-AI.md"
fi

echo ""
echo "=================================================="
