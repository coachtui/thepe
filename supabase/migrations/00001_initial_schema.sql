-- Migration: Initial Schema for Construction Copilot
-- Created: 2025-01-27

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Organizations (multi-tenant)
CREATE TABLE organizations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  subscription_tier text DEFAULT 'starter',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Users
CREATE TABLE users (
  id uuid REFERENCES auth.users(id) PRIMARY KEY,
  email text UNIQUE NOT NULL,
  full_name text,
  role text CHECK (role IN ('admin', 'project_manager', 'superintendent', 'viewer')),
  organization_id uuid REFERENCES organizations(id),
  created_at timestamptz DEFAULT now()
);

-- Projects
CREATE TABLE projects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  address text,
  project_number text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'completed', 'on_hold')),
  start_date date,
  end_date date,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Project Members (access control)
CREATE TABLE project_members (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  role text CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- Documents (plans, specs, submittals)
CREATE TABLE documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  filename text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL,
  document_type text,
  sheet_number text,
  discipline text,
  revision text,
  description text,
  page_count integer,
  file_size_bytes bigint,
  processing_status text DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  metadata jsonb DEFAULT '{}',
  uploaded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Document Chunks (for RAG)
CREATE TABLE document_chunks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  content text NOT NULL,
  page_number integer,
  chunk_type text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Vector Embeddings (pgvector)
CREATE TABLE document_embeddings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  chunk_id uuid REFERENCES document_chunks(id) ON DELETE CASCADE,
  embedding vector(1536),
  model_version text DEFAULT 'text-embedding-ada-002',
  created_at timestamptz DEFAULT now()
);

-- RFIs
CREATE TABLE rfis (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  rfi_number text NOT NULL,
  subject text NOT NULL,
  question text NOT NULL,
  response text,
  status text DEFAULT 'open' CHECK (status IN ('draft', 'open', 'responded', 'closed')),
  priority text DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  due_date date,
  submitted_by uuid REFERENCES users(id),
  assigned_to text,
  related_documents uuid[],
  related_activities uuid[],
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Query History (for learning/analytics)
CREATE TABLE query_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id),
  query_text text NOT NULL,
  query_type text,
  response_text text,
  sources jsonb,
  feedback_rating integer CHECK (feedback_rating BETWEEN 1 AND 5),
  latency_ms integer,
  tokens_used integer,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_documents_type ON documents(document_type);
CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_document_embeddings_chunk ON document_embeddings(chunk_id);
CREATE INDEX idx_rfis_project ON rfis(project_id);
CREATE INDEX idx_rfis_status ON rfis(status);
CREATE INDEX idx_query_history_project ON query_history(project_id);
CREATE INDEX idx_project_members_user ON project_members(user_id);
CREATE INDEX idx_project_members_project ON project_members(project_id);

-- Vector similarity search index
CREATE INDEX idx_document_embeddings_vector ON document_embeddings
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
