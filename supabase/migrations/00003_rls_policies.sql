-- Migration: Row Level Security Policies
-- Created: 2025-01-27

-- Enable RLS on all tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_predecessors ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_versions ENABLE ROW LEVEL SECURITY;

-- Organizations: Users can see their own organization
CREATE POLICY organizations_select ON organizations
  FOR SELECT USING (
    id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

-- Users: Can see users in their organization
CREATE POLICY users_select ON users
  FOR SELECT USING (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
    OR id = auth.uid()
  );

CREATE POLICY users_update_own ON users
  FOR UPDATE USING (id = auth.uid());

-- Projects: Can see projects they're a member of
CREATE POLICY projects_select ON projects
  FOR SELECT USING (
    id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );

CREATE POLICY projects_insert ON projects
  FOR INSERT WITH CHECK (
    organization_id IN (SELECT organization_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY projects_update ON projects
  FOR UPDATE USING (
    id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

CREATE POLICY projects_delete ON projects
  FOR DELETE USING (
    id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role = 'owner')
  );

-- Project Members: Can see members of projects they're in
CREATE POLICY project_members_select ON project_members
  FOR SELECT USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );

CREATE POLICY project_members_insert ON project_members
  FOR INSERT WITH CHECK (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

CREATE POLICY project_members_delete ON project_members
  FOR DELETE USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role = 'owner')
  );

-- Documents: Can access documents in their projects
CREATE POLICY documents_select ON documents
  FOR SELECT USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );

CREATE POLICY documents_insert ON documents
  FOR INSERT WITH CHECK (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

CREATE POLICY documents_update ON documents
  FOR UPDATE USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

CREATE POLICY documents_delete ON documents
  FOR DELETE USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

-- Document Chunks: Inherit from documents
CREATE POLICY document_chunks_select ON document_chunks
  FOR SELECT USING (
    document_id IN (
      SELECT id FROM documents WHERE project_id IN (
        SELECT project_id FROM project_members WHERE user_id = auth.uid()
      )
    )
  );

-- Document Embeddings: Inherit from chunks
CREATE POLICY document_embeddings_select ON document_embeddings
  FOR SELECT USING (
    chunk_id IN (
      SELECT dc.id FROM document_chunks dc
      JOIN documents d ON dc.document_id = d.id
      WHERE d.project_id IN (
        SELECT project_id FROM project_members WHERE user_id = auth.uid()
      )
    )
  );

-- RFIs: Can access RFIs in their projects
CREATE POLICY rfis_select ON rfis
  FOR SELECT USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );

CREATE POLICY rfis_insert ON rfis
  FOR INSERT WITH CHECK (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

CREATE POLICY rfis_update ON rfis
  FOR UPDATE USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

-- Query History: Users can see their own queries
CREATE POLICY query_history_select ON query_history
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY query_history_insert ON query_history
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Schedule Activities: Inherit from projects
CREATE POLICY schedule_activities_select ON schedule_activities
  FOR SELECT USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );

CREATE POLICY schedule_activities_insert ON schedule_activities
  FOR INSERT WITH CHECK (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

CREATE POLICY schedule_activities_update ON schedule_activities
  FOR UPDATE USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid() AND role IN ('owner', 'editor'))
  );

-- Activity Predecessors: Inherit from activities
CREATE POLICY activity_predecessors_select ON activity_predecessors
  FOR SELECT USING (
    activity_id IN (
      SELECT id FROM schedule_activities WHERE project_id IN (
        SELECT project_id FROM project_members WHERE user_id = auth.uid()
      )
    )
  );

-- Activity Documents: Inherit from activities
CREATE POLICY activity_documents_select ON activity_documents
  FOR SELECT USING (
    activity_id IN (
      SELECT id FROM schedule_activities WHERE project_id IN (
        SELECT project_id FROM project_members WHERE user_id = auth.uid()
      )
    )
  );

-- Schedule Versions: Inherit from projects
CREATE POLICY schedule_versions_select ON schedule_versions
  FOR SELECT USING (
    project_id IN (SELECT project_id FROM project_members WHERE user_id = auth.uid())
  );
