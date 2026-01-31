-- Migration: Fix users table INSERT policy
-- Created: 2026-01-27
-- Issue: Users cannot create their own profile during signup

-- Allow users to insert their own profile during signup
CREATE POLICY users_insert ON users
  FOR INSERT WITH CHECK (id = auth.uid());

-- Allow organizations to be created (needed for signup)
CREATE POLICY organizations_insert ON organizations
  FOR INSERT WITH CHECK (true);
