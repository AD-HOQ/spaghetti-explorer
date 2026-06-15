CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE document_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parent_id uuid REFERENCES document_nodes(id) ON DELETE CASCADE,
  node_type varchar NOT NULL CHECK (node_type IN ('site', 'library', 'folder', 'document')),
  name varchar NOT NULL,
  path varchar,
  depth int NOT NULL DEFAULT 0,
  source_system varchar NOT NULL DEFAULT 'SharePoint' CHECK (source_system IN ('SharePoint', 'OneDrive')),
  source_id varchar NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, source_id)
);

CREATE INDEX document_nodes_parent_idx ON document_nodes (tenant_id, parent_id);

CREATE TABLE principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  principal_type varchar NOT NULL CHECK (principal_type IN ('user', 'guest', 'group', 'role', 'team')),
  display_name varchar NOT NULL,
  email varchar,
  job_title varchar,
  description varchar,
  group_type varchar CHECK (group_type IN ('domain', 'm365', 'security')),
  external_id varchar NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)
);

CREATE INDEX principals_lookup_idx ON principals (tenant_id, principal_type, display_name);

CREATE TABLE principal_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  parent_principal_id uuid NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  child_principal_id uuid NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, parent_principal_id, child_principal_id)
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL REFERENCES document_nodes(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  permission_type varchar NOT NULL CHECK (permission_type IN ('read', 'write', 'delete', 'share', 'owner')),
  effect varchar NOT NULL CHECK (effect IN ('allow', 'deny')),
  inherit boolean NOT NULL,
  permission_source varchar CHECK (permission_source IN ('direct', 'inherited', 'sharing_link', 'external_system')),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, node_id, principal_id, permission_type, permission_source)
);

CREATE TABLE effective_access_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  node_id uuid NOT NULL REFERENCES document_nodes(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  can_read boolean NOT NULL,
  can_write boolean NOT NULL,
  can_delete boolean NOT NULL,
  can_share boolean NOT NULL,
  is_owner boolean NOT NULL,
  has_access boolean NOT NULL,
  access_source_summary varchar,
  calculated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, principal_id, node_id)
);

CREATE INDEX effective_access_principal_access_idx
  ON effective_access_cache (tenant_id, principal_id, has_access);
CREATE INDEX effective_access_node_idx ON effective_access_cache (tenant_id, node_id);

CREATE TABLE effective_access_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  effective_access_id uuid NOT NULL REFERENCES effective_access_cache(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES document_nodes(id) ON DELETE CASCADE,
  selected_principal_id uuid NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  granted_by_principal_id uuid REFERENCES principals(id) ON DELETE SET NULL,
  source_node_id uuid REFERENCES document_nodes(id) ON DELETE SET NULL,
  permission_type varchar NOT NULL,
  effect varchar NOT NULL CHECK (effect IN ('allow', 'deny')),
  inherited boolean NOT NULL,
  reason varchar,
  calculated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX effective_access_sources_access_idx ON effective_access_sources (effective_access_id);

CREATE TABLE document_node_closure (
  ancestor_node_id uuid NOT NULL REFERENCES document_nodes(id) ON DELETE CASCADE,
  descendant_node_id uuid NOT NULL REFERENCES document_nodes(id) ON DELETE CASCADE,
  distance int NOT NULL CHECK (distance >= 0),
  PRIMARY KEY (ancestor_node_id, descendant_node_id)
);

CREATE INDEX document_node_closure_descendant_idx ON document_node_closure (descendant_node_id);

CREATE TABLE microsoft_tenant_connections (
  tenant_id uuid PRIMARY KEY,
  tenant_display_name varchar,
  application_object_id uuid,
  client_id uuid,
  service_principal_object_id uuid,
  credential_key_id uuid,
  credential_expires_at timestamptz,
  encrypted_client_secret text,
  granted_permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar NOT NULL,
  health varchar NOT NULL,
  failure_reason text,
  created_by_user_id uuid,
  created_by_upn varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz
);

CREATE TABLE microsoft_onboarding_states (
  state varchar PRIMARY KEY,
  nonce varchar NOT NULL,
  code_verifier_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE microsoft_onboarding_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  event_type varchar NOT NULL,
  outcome varchar NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX microsoft_onboarding_audit_tenant_idx ON microsoft_onboarding_audit_log (tenant_id, created_at DESC);

CREATE TABLE permission_action_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL,
  event_type varchar NOT NULL CHECK (event_type IN ('loaded', 'running', 'succeeded', 'failed')),
  action_kind varchar NOT NULL,
  action_label varchar NOT NULL,
  node_id varchar NOT NULL,
  node_name varchar NOT NULL,
  principal_id varchar,
  principal_name varchar,
  grant_index int,
  command jsonb NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX permission_action_logs_action_idx ON permission_action_logs (action_id, created_at);
CREATE INDEX permission_action_logs_created_idx ON permission_action_logs (created_at DESC);

CREATE OR REPLACE FUNCTION rebuild_document_node_closure(target_tenant uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM document_node_closure c
  USING document_nodes n
  WHERE c.descendant_node_id = n.id AND n.tenant_id = target_tenant;

  WITH RECURSIVE tree AS (
    SELECT id AS ancestor_id, id AS descendant_id, 0 AS distance
    FROM document_nodes WHERE tenant_id = target_tenant
    UNION ALL
    SELECT tree.ancestor_id, child.id, tree.distance + 1
    FROM tree
    JOIN document_nodes child ON child.parent_id = tree.descendant_id
    WHERE child.tenant_id = target_tenant
  )
  INSERT INTO document_node_closure (ancestor_node_id, descendant_node_id, distance)
  SELECT ancestor_id, descendant_id, distance FROM tree;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_effective_access(target_tenant uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM effective_access_cache WHERE tenant_id = target_tenant;

  WITH RECURSIVE membership AS (
    SELECT id AS selected_id, id AS grants_id
    FROM principals WHERE tenant_id = target_tenant
    UNION
    SELECT membership.selected_id, pm.parent_principal_id
    FROM membership
    JOIN principal_memberships pm ON pm.child_principal_id = membership.grants_id
    WHERE pm.tenant_id = target_tenant
  ),
  resolved AS (
    SELECT
      p.node_id,
      m.selected_id AS principal_id,
      bool_or(p.permission_type IN ('read', 'write', 'delete', 'share', 'owner') AND p.effect = 'allow') AS can_read,
      bool_or(p.permission_type IN ('write', 'owner') AND p.effect = 'allow') AS can_write,
      bool_or(p.permission_type IN ('delete', 'owner') AND p.effect = 'allow') AS can_delete,
      bool_or(p.permission_type IN ('share', 'owner') AND p.effect = 'allow') AS can_share,
      bool_or(p.permission_type = 'owner' AND p.effect = 'allow') AS is_owner,
      string_agg(DISTINCT grantor.display_name, ', ') AS source_summary
    FROM permissions p
    JOIN membership m ON m.grants_id = p.principal_id
    JOIN principals grantor ON grantor.id = p.principal_id
    WHERE p.tenant_id = target_tenant
    GROUP BY p.node_id, m.selected_id
  )
  INSERT INTO effective_access_cache (
    tenant_id, node_id, principal_id, can_read, can_write, can_delete,
    can_share, is_owner, has_access, access_source_summary
  )
  SELECT target_tenant, node_id, principal_id, can_read, can_write, can_delete,
    can_share, is_owner, can_read, source_summary
  FROM resolved;
END;
$$;
