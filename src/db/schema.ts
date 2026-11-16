import { relations } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const pgVectorType = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    if (!value || value === '[]') return [];
    return value
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((n) => Number(n));
  },
});

const tsvectorType = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

// ============================================================================
// Phase 1 Core Tables: Users, Auth Sessions/Accounts, RBAC, Storage, Settings, Audit
// ============================================================================

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    username: text('username').notNull(),
    displayUsername: text('display_username'),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    name: text('name').notNull(),
    image: text('image'),
    firebaseUid: text('firebase_uid'),
    status: text('status').notNull().default('active'), // active | inactive | suspended
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    isBootstrapAdmin: boolean('is_bootstrap_admin').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('users_username_unique_idx').on(table.username),
    uniqueIndex('users_email_unique_idx').on(table.email),
    uniqueIndex('users_firebase_uid_unique_idx').on(table.firebaseUid),
    index('users_status_idx').on(table.status),
  ]
);

export const authSessions = pgTable(
  'authentication_sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    authMethod: text('auth_method').notNull().default('credentials'),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_unique_idx').on(table.token),
    index('auth_sessions_user_id_idx').on(table.userId),
    index('auth_sessions_expires_at_idx').on(table.expiresAt),
  ]
);

export const authAccounts = pgTable(
  'authentication_accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('auth_accounts_user_id_idx').on(table.userId),
    uniqueIndex('auth_accounts_provider_account_idx').on(table.providerId, table.accountId),
  ]
);

export const authVerifications = pgTable(
  'authentication_verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('auth_verifications_identifier_idx').on(table.identifier)]
);

// ============================================================================
// RBAC: Roles, Action-Level Permissions, Role Permissions, User Overrides
// ============================================================================

export const roles = pgTable(
  'roles',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    nameFa: text('name_fa').notNull(),
    descriptionFa: text('description_fa'),
    isSystem: boolean('is_system').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('roles_slug_unique_idx').on(table.slug)]
);

export const permissions = pgTable(
  'permissions',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    module: text('module').notNull(), // support_desk | shared_files | knowledge_base | ai_settings | administration
    nameFa: text('name_fa').notNull(),
    descriptionFa: text('description_fa'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('permissions_key_unique_idx').on(table.key),
    index('permissions_module_idx').on(table.module),
  ]
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.roleId] }),
    index('user_roles_user_id_idx').on(table.userId),
    index('user_roles_role_id_idx').on(table.roleId),
  ]
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.permissionId] }),
    index('role_permissions_role_id_idx').on(table.roleId),
  ]
);

export const userPermissionOverrides = pgTable(
  'user_permission_overrides',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionId: text('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    effect: text('effect').notNull(), // allow | deny
    reason: text('reason'),
    grantedBy: text('granted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.permissionId] }),
    index('user_perm_overrides_user_id_idx').on(table.userId),
  ]
);

// ============================================================================
// Persistent Storage Quotas & System Settings & Audit Logs
// ============================================================================

export const storageQuotas = pgTable(
  'storage_quotas',
  {
    id: text('id').primaryKey(),
    scopeType: text('scope_type').notNull(), // global | department | operator
    scopeId: text('scope_id').notNull().default('global'),
    driver: text('driver').notNull().default('local'), // local | s3
    maxBytes: bigint('max_bytes', { mode: 'number' }).notNull(),
    usedBytes: bigint('used_bytes', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('storage_quotas_scope_unique_idx').on(table.scopeType, table.scopeId),
  ]
);

export const systemSettings = pgTable('system_settings', {
  key: text('key').primaryKey(),
  valueJson: jsonb('value_json').$type<Record<string, unknown>>().notNull(),
  isSensitive: boolean('is_sensitive').notNull().default(false),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorType: text('actor_type').notNull().default('user'), // user | system | anonymous
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_logs_actor_idx').on(table.actorUserId),
    index('audit_logs_action_idx').on(table.action),
    index('audit_logs_created_at_idx').on(table.createdAt),
  ]
);

// ============================================================================
// Phase 2: Departments, Department Memberships, Operator Availability
// ============================================================================

export const departments = pgTable(
  'departments',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    nameFa: text('name_fa').notNull(),
    descriptionFa: text('description_fa').notNull().default(''),
    iconKey: text('icon_key').notNull().default('building'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    isPublic: boolean('is_public').notNull().default(true),
    aiEnabled: boolean('ai_enabled').notNull().default(true),
    humanOperatorsAvailable: boolean('human_operators_available').notNull().default(true),
    assignmentStrategy: text('assignment_strategy').notNull().default('round_robin'), // round_robin | least_loaded | manual_queue
    welcomeMessageFa: text('welcome_message_fa').notNull().default(''),
    maxUploadSizeMb: integer('max_upload_size_mb').notNull().default(10),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('departments_slug_unique_idx').on(table.slug),
    index('departments_public_order_idx').on(table.isActive, table.isPublic, table.displayOrder),
  ]
);

export const departmentMemberships = pgTable(
  'department_memberships',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isManager: boolean('is_manager').notNull().default(false),
    isAvailable: boolean('is_available').notNull().default(true),
    maxActiveTickets: integer('max_active_tickets').notNull().default(15),
    assignedBy: text('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('dept_memberships_dept_user_unique_idx').on(table.departmentId, table.userId),
    index('dept_memberships_user_id_idx').on(table.userId),
    index('dept_memberships_dept_id_idx').on(table.departmentId),
  ]
);

export const operatorAvailability = pgTable('operator_availability', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  isAvailable: boolean('is_available').notNull().default(true),
  availabilityNote: text('availability_note'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ============================================================================
// Phase 3: Knowledge Base Collections, Documents, Chunks, Q&A, AI Settings & Chat
// ============================================================================

export const knowledgeCollections = pgTable(
  'knowledge_collections',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    nameFa: text('name_fa').notNull(),
    descriptionFa: text('description_fa').notNull().default(''),
    scope: text('scope').notNull().default('department'), // global | department | restricted
    isActive: boolean('is_active').notNull().default(true),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('kb_collections_slug_unique_idx').on(table.slug),
    index('kb_collections_scope_idx').on(table.scope, table.isActive),
  ]
);

export const departmentKnowledgeCollections = pgTable(
  'department_knowledge_collections',
  {
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    collectionId: text('collection_id')
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: 'cascade' }),
    assignedBy: text('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.departmentId, table.collectionId] }),
    index('dept_kb_collections_dept_idx').on(table.departmentId),
  ]
);

export const knowledgeDocuments = pgTable(
  'knowledge_documents',
  {
    id: text('id').primaryKey(),
    collectionId: text('collection_id').references(() => knowledgeCollections.id, {
      onDelete: 'set null',
    }),
    titleFa: text('title_fa').notNull(),
    originalFilename: text('original_filename').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    fileExtension: text('file_extension').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    scope: text('scope').notNull().default('department'), // global | department | restricted
    classification: text('classification').notNull().default('department'), // public_org | department | internal_restricted
    status: text('status').notNull().default('uploaded'), // uploaded | processing | indexed | failed | disabled
    ingestionStage: text('ingestion_stage').notNull().default('completed'), // queued | validating | extracting | normalizing | chunking | embedding | indexing | completed | failed
    validityStatus: text('validity_status').notNull().default('current'), // current | superseded | expired
    supersededByDocId: text('superseded_by_doc_id'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    effectiveUntil: timestamp('effective_until', { withTimezone: true }),
    isEnabled: boolean('is_enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    extractedText: text('extracted_text'),
    chunkCount: integer('chunk_count').notNull().default(0),
    embeddingModelUsed: text('embedding_model_used'),
    embeddingDimensions: integer('embedding_dimensions'),
    errorMessage: text('error_message'),
    lastIndexedAt: timestamp('last_indexed_at', { withTimezone: true }),
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('kb_docs_collection_idx').on(table.collectionId),
    index('kb_docs_status_idx').on(table.status, table.isEnabled),
    index('kb_docs_scope_idx').on(table.scope),
    index('kb_docs_validity_idx').on(table.validityStatus, table.isEnabled),
  ]
);

export const knowledgeDocumentVersions = pgTable(
  'knowledge_document_versions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    originalFilename: text('original_filename').notNull(),
    storageKey: text('storage_key').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('kb_doc_versions_doc_idx').on(table.documentId)]
);

export const knowledgeDocumentDepartments = pgTable(
  'knowledge_document_departments',
  {
    documentId: text('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.departmentId] }),
    index('kb_doc_depts_dept_idx').on(table.departmentId),
  ]
);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    documentVersion: integer('document_version').notNull().default(1),
    parentChunkId: text('parent_chunk_id'),
    chunkLevel: text('chunk_level').notNull().default('child'), // parent | child
    chunkIndex: integer('chunk_index').notNull(),
    headingPath: text('heading_path'),
    sectionTitle: text('section_title'),
    pageNumber: integer('page_number'),
    sheetName: text('sheet_name'),
    chunkType: text('chunk_type').notNull().default('text'), // text | table | list | section
    classification: text('classification').notNull().default('department'),
    sourceRef: text('source_ref'),
    isActive: boolean('is_active').notNull().default(true),
    content: text('content').notNull(),
    normalizedContent: text('normalized_content').notNull(),
    tokenEstimate: integer('token_estimate').notNull().default(0),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>(),
    embeddingJson: jsonb('embedding_json').$type<number[] | null>(),
    embeddingModel: text('embedding_model'),
    embeddingDimensions: integer('embedding_dimensions'),
    searchTsv: tsvectorType('search_tsv'),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('kb_chunks_doc_idx').on(table.documentId, table.chunkIndex),
    index('kb_chunks_active_level_idx').on(
      table.documentId,
      table.isActive,
      table.chunkLevel
    ),
    index('kb_chunks_parent_idx').on(table.parentChunkId),
    index('kb_chunks_search_tsv_gin_idx').using('gin', table.searchTsv),
  ]
);

export const knowledgeChunkVectors = pgTable(
  'knowledge_chunk_vectors',
  {
    chunkId: text('chunk_id')
      .primaryKey()
      .references(() => knowledgeChunks.id, { onDelete: 'cascade' }),
    documentId: text('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    documentVersion: integer('document_version').notNull().default(1),
    embeddingModel: text('embedding_model').notNull(),
    dimensions: integer('dimensions').notNull(),
    embedding: pgVectorType('embedding').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('kb_chunk_vecs_doc_active_idx').on(table.documentId, table.isActive),
    index('kb_chunk_vecs_model_dim_idx').on(
      table.embeddingModel,
      table.dimensions,
      table.isActive
    ),
  ]
);

export const knowledgeQaEntries = pgTable(
  'knowledge_qa_entries',
  {
    id: text('id').primaryKey(),
    collectionId: text('collection_id').references(() => knowledgeCollections.id, {
      onDelete: 'set null',
    }),
    question: text('question').notNull(),
    alternativeQuestions: jsonb('alternative_questions').$type<string[]>().notNull().default([]),
    officialAnswer: text('official_answer').notNull(),
    category: text('category').notNull().default('عمومی'),
    keywords: jsonb('keywords').$type<string[]>().notNull().default([]),
    scope: text('scope').notNull().default('department'), // global | department | restricted
    status: text('status').notNull().default('published'), // draft | published | disabled
    normalizedSearchText: text('normalized_search_text').notNull(),
    embeddingJson: jsonb('embedding_json').$type<number[] | null>(),
    embeddingModel: text('embedding_model'),
    embeddingDimensions: integer('embedding_dimensions'),
    searchTsv: tsvectorType('search_tsv'),
    updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('kb_qa_status_scope_idx').on(table.status, table.scope),
    index('kb_qa_collection_idx').on(table.collectionId),
    index('kb_qa_search_tsv_gin_idx').using('gin', table.searchTsv),
  ]
);

export const knowledgeQaVectors = pgTable(
  'knowledge_qa_vectors',
  {
    qaEntryId: text('qa_entry_id')
      .primaryKey()
      .references(() => knowledgeQaEntries.id, { onDelete: 'cascade' }),
    embeddingModel: text('embedding_model').notNull(),
    dimensions: integer('dimensions').notNull(),
    embedding: pgVectorType('embedding').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('kb_qa_vecs_model_dim_idx').on(
      table.embeddingModel,
      table.dimensions,
      table.isActive
    ),
  ]
);

export const ragIngestionJobs = pgTable(
  'rag_ingestion_jobs',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: 'cascade' }),
    jobType: text('job_type').notNull(), // ingest | replace | reprocess | reindex_embeddings
    status: text('status').notNull().default('pending'), // pending | running | completed | failed | cancelled
    stage: text('stage').notNull().default('queued'), // queued | validating | extracting | normalizing | chunking | embedding | indexing | completed | failed
    targetVersion: integer('target_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    totalChunks: integer('total_chunks').notNull().default(0),
    processedChunks: integer('processed_chunks').notNull().default(0),
    embeddingModel: text('embedding_model'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default({}),
    triggeredByUserId: text('triggered_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('rag_jobs_status_created_idx').on(table.status, table.createdAt),
    index('rag_jobs_doc_created_idx').on(table.documentId, table.createdAt),
  ]
);

export const knowledgeQaDepartments = pgTable(
  'knowledge_qa_departments',
  {
    qaEntryId: text('qa_entry_id')
      .notNull()
      .references(() => knowledgeQaEntries.id, { onDelete: 'cascade' }),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.qaEntryId, table.departmentId] }),
    index('kb_qa_depts_dept_idx').on(table.departmentId),
  ]
);

export const aiProviderSettings = pgTable('ai_provider_settings', {
  id: text('id').primaryKey(), // 'default'
  providerType: text('provider_type').notNull().default('gemini'), // gemini | openai_compatible
  providerName: text('provider_name').notNull().default('Google Gemini'),
  baseUrl: text('base_url'),
  encryptedApiKey: text('encrypted_api_key'),
  apiKeyHint: text('api_key_hint'),
  chatModel: text('chat_model').notNull().default('gemini-4-hydrogen'),
  embeddingModel: text('embedding_model'),
  timeoutMs: integer('timeout_ms').notNull().default(25000),
  maxOutputTokens: integer('max_output_tokens').notNull().default(1024),
  temperature: text('temperature').notNull().default('0.1'),
  globalEnabled: boolean('global_enabled').notNull().default(false),
  rerankerMode: text('reranker_mode').notNull().default('cross_feature'), // none | cross_feature | llm | http_cross_encoder
  rerankerEndpointUrl: text('reranker_endpoint_url'),
  cragMaxIterations: integer('crag_max_iterations').notNull().default(2),
  cragMaxModelCalls: integer('crag_max_model_calls').notNull().default(2),
  cragEnableLlmJudge: boolean('crag_enable_llm_judge').notNull().default(false),
  enableLlmQueryTransform: boolean('enable_llm_query_transform').notNull().default(false),
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  lastTestOk: boolean('last_test_ok'),
  lastTestMessage: text('last_test_message'),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiDepartmentSettings = pgTable('ai_department_settings', {
  departmentId: text('department_id')
    .primaryKey()
    .references(() => departments.id, { onDelete: 'cascade' }),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  welcomeMessageFa: text('welcome_message_fa').notNull().default(''),
  fallbackMessageFa: text('fallback_message_fa')
    .notNull()
    .default(
      'برای پاسخ دقیق به این سؤال، اطلاعات تأییدشده‌ای در مخزن دانش سازمان پیدا نشد. می‌توانید درخواست خود را به اپراتور مربوطه ارجاع دهید.'
    ),
  autoOfferEscalation: boolean('auto_offer_escalation').notNull().default(true),
  minConfidenceScore: integer('min_confidence_score').notNull().default(25),
  maxTurnsPerSession: integer('max_turns_per_session').notNull().default(20),
  allowAiDuringHumanHandoff: boolean('allow_ai_during_human_handoff')
    .notNull()
    .default(false),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    mode: text('mode').notNull().default('ai_assisted'), // ai_assisted | waiting_for_operator | assigned_to_operator | human_operator_active | resolved
    escalatedToHuman: boolean('escalated_to_human').notNull().default(false),
    handoffRequestedAt: timestamp('handoff_requested_at', { withTimezone: true }),
    handoffReason: text('handoff_reason'),
    aiAutoReplyEnabled: boolean('ai_auto_reply_enabled').notNull().default(true),
    turnCount: integer('turn_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ai_conversations_dept_idx').on(table.departmentId),
    index('ai_conversations_mode_idx').on(table.mode),
  ]
);

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    senderRole: text('sender_role').notNull(), // customer | ai_assistant | system
    content: text('content').notNull(),
    abstained: boolean('abstained').notNull().default(false),
    escalationOffered: boolean('escalation_offered').notNull().default(false),
    retrievalConfidence: integer('retrieval_confidence'),
    responseOutcome: text('response_outcome'), // verified_answer | abstain_insufficient | abstain_conflicting | clarify | provider_unavailable | prompt_injection_blocked
    citationsJson: jsonb('citations_json')
      .$type<
        Array<{
          refCode: string;
          sourceType: 'qa' | 'document_chunk';
          sourceId: string;
          parentId: string;
          title: string;
          documentVersion: number | null;
          validityStatus: string;
          pageNumber: number | null;
          sheetName: string | null;
          sectionTitle: string | null;
          headingPath: string | null;
          sourceRef: string | null;
          score: number;
          snippet: string;
        }>
      >()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('ai_messages_conv_idx').on(table.conversationId, table.createdAt)]
);

export const knowledgeRetrievalRecords = pgTable(
  'knowledge_retrieval_records',
  {
    id: text('id').primaryKey(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .notNull()
      .references(() => aiMessages.id, { onDelete: 'cascade' }),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    queryText: text('query_text').notNull(),
    sourcesJson: jsonb('sources_json')
      .$type<
        Array<{
          sourceType: 'qa' | 'document_chunk';
          sourceId: string;
          title: string;
          score: number;
          snippet: string;
          documentVersion?: number | null;
          pageNumber?: number | null;
          sectionTitle?: string | null;
          sheetName?: string | null;
          sourceRef?: string | null;
        }>
      >()
      .notNull()
      .default([]),
    traceJson: jsonb('trace_json').$type<Record<string, unknown>>().notNull().default({}),
    topScore: integer('top_score').notNull().default(0),
    abstained: boolean('abstained').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('kb_retrieval_conv_idx').on(table.conversationId),
    index('kb_retrieval_dept_idx').on(table.departmentId),
  ]
);

export const ragEvaluationRuns = pgTable(
  'rag_evaluation_runs',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id').references(() => departments.id, {
      onDelete: 'set null',
    }),
    runLabel: text('run_label').notNull(),
    totalCases: integer('total_cases').notNull().default(0),
    passedCases: integer('passed_cases').notNull().default(0),
    recallAtK: doublePrecision('recall_at_k').notNull().default(0),
    precisionAtK: doublePrecision('precision_at_k').notNull().default(0),
    mrr: doublePrecision('mrr').notNull().default(0),
    ndcg: doublePrecision('ndcg').notNull().default(0),
    avgLatencyMs: integer('avg_latency_ms').notNull().default(0),
    faithfulnessAvg: doublePrecision('faithfulness_avg').notNull().default(0),
    answerRelevanceAvg: doublePrecision('answer_relevance_avg').notNull().default(0),
    citationCorrectnessRate: doublePrecision('citation_correctness_rate').notNull().default(0),
    abstentionAccuracyRate: doublePrecision('abstention_accuracy_rate').notNull().default(0),
    unsupportedClaimRate: doublePrecision('unsupported_claim_rate').notNull().default(0),
    resultsJson: jsonb('results_json')
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    triggeredByUserId: text('triggered_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('rag_eval_runs_created_idx').on(table.createdAt),
    index('rag_eval_runs_dept_idx').on(table.departmentId, table.createdAt),
  ]
);

export const aiUsageLogs = pgTable(
  'ai_usage_logs',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id').references(() => departments.id, {
      onDelete: 'set null',
    }),
    conversationId: text('conversation_id'),
    providerType: text('provider_type').notNull(),
    modelName: text('model_name').notNull(),
    status: text('status').notNull(), // success | abstained | provider_error | rate_limited | escalated
    latencyMs: integer('latency_ms').notNull().default(0),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ai_usage_logs_dept_idx').on(table.departmentId),
    index('ai_usage_logs_created_idx').on(table.createdAt),
  ]
);

// ============================================================================
// Phase 4: Customer Identity, OTP Verification, Ticketing, Attachments & Notifications
// ============================================================================

export const customerProfiles = pgTable(
  'customer_profiles',
  {
    id: text('id').primaryKey(),
    nationalIdHmac: text('national_id_hmac').notNull(),
    encryptedNationalId: text('encrypted_national_id').notNull(),
    nationalIdLast4: text('national_id_last4').notNull(),
    fullName: text('full_name').notNull(),
    encryptedPhone: text('encrypted_phone'),
    phoneMasked: text('phone_masked'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('customer_profiles_nid_hmac_unique_idx').on(table.nationalIdHmac),
  ]
);

export const identityVerificationRecords = pgTable(
  'identity_verification_records',
  {
    id: text('id').primaryKey(),
    customerProfileId: text('customer_profile_id').references(() => customerProfiles.id, {
      onDelete: 'set null',
    }),
    nationalIdHmac: text('national_id_hmac').notNull(),
    fullNameSnapshot: text('full_name_snapshot').notNull(),
    purpose: text('purpose').notNull().default('customer_portal'),
    otpCodeHash: text('otp_code_hash').notNull(),
    deliveryChannel: text('delivery_channel').notNull().default('dev_mock'),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('id_verif_nid_created_idx').on(table.nationalIdHmac, table.createdAt),
  ]
);

export const customerSessions = pgTable(
  'customer_sessions',
  {
    id: text('id').primaryKey(),
    customerProfileId: text('customer_profile_id')
      .notNull()
      .references(() => customerProfiles.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('customer_sessions_token_hash_unique_idx').on(table.tokenHash),
    index('customer_sessions_profile_idx').on(table.customerProfileId),
  ]
);

export const departmentRoutingState = pgTable('department_routing_state', {
  departmentId: text('department_id')
    .primaryKey()
    .references(() => departments.id, { onDelete: 'cascade' }),
  lastAssignedUserId: text('last_assigned_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  ticketSeq: integer('ticket_seq').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const tickets = pgTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    referenceCode: text('reference_code').notNull(),
    customerProfileId: text('customer_profile_id')
      .notNull()
      .references(() => customerProfiles.id, { onDelete: 'restrict' }),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    assignedOperatorId: text('assigned_operator_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    linkedAiConversationId: text('linked_ai_conversation_id').references(
      () => aiConversations.id,
      { onDelete: 'set null' }
    ),
    subject: text('subject').notNull(),
    status: text('status').notNull().default('open'), // open | waiting_for_operator | assigned | in_progress | waiting_for_customer | resolved | closed
    priority: text('priority').notNull().default('normal'), // low | normal | high | urgent
    conversationMode: text('conversation_mode').notNull().default('waiting_for_operator'), // ai_assisted | waiting_for_operator | assigned_to_operator | human_operator_active | resolved
    aiAutoReplyEnabled: boolean('ai_auto_reply_enabled').notNull().default(false),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tickets_reference_code_unique_idx').on(table.referenceCode),
    index('tickets_dept_status_idx').on(table.departmentId, table.status, table.lastMessageAt),
    index('tickets_operator_status_idx').on(table.assignedOperatorId, table.status),
    index('tickets_customer_idx').on(table.customerProfileId, table.lastMessageAt),
    index('tickets_ai_conv_idx').on(table.linkedAiConversationId),
  ]
);

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    senderType: text('sender_type').notNull(), // customer | operator | ai_assistant | system
    senderUserId: text('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
    senderCustomerId: text('sender_customer_id').references(() => customerProfiles.id, {
      onDelete: 'set null',
    }),
    visibility: text('visibility').notNull().default('public'), // public | internal_note
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ticket_messages_ticket_created_idx').on(table.ticketId, table.createdAt),
  ]
);

export const ticketAttachments = pgTable(
  'ticket_attachments',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    messageId: text('message_id').references(() => ticketMessages.id, {
      onDelete: 'set null',
    }),
    uploadedByType: text('uploaded_by_type').notNull(), // customer | operator
    uploadedByUserId: text('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    originalFilename: text('original_filename').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    fileExtension: text('file_extension').notNull(),
    byteSize: integer('byte_size').notNull(),
    sha256: text('sha256').notNull(),
    scanStatus: text('scan_status').notNull().default('skipped'), // skipped | clean | quarantined
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('ticket_attachments_storage_key_unique_idx').on(table.storageKey),
    index('ticket_attachments_ticket_idx').on(table.ticketId, table.createdAt),
  ]
);

export const ticketAssignments = pgTable(
  'ticket_assignments',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    fromDepartmentId: text('from_department_id').references(() => departments.id, {
      onDelete: 'set null',
    }),
    toDepartmentId: text('to_department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'restrict' }),
    fromOperatorId: text('from_operator_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    toOperatorId: text('to_operator_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    assignedByUserId: text('assigned_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    strategyUsed: text('strategy_used').notNull(), // round_robin | least_loaded | manual_queue | manual_reassign | department_transfer
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ticket_assignments_ticket_idx').on(table.ticketId, table.createdAt),
  ]
);

export const ticketStatusHistory = pgTable(
  'ticket_status_history',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    changedByType: text('changed_by_type').notNull(), // system | customer | operator
    changedByUserId: text('changed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ticket_status_history_ticket_idx').on(table.ticketId, table.createdAt),
  ]
);

export const ticketActivity = pgTable(
  'ticket_activity',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    activityType: text('activity_type').notNull(),
    actorLabel: text('actor_label').notNull(),
    detailsJson: jsonb('details_json').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('ticket_activity_ticket_idx').on(table.ticketId, table.createdAt),
  ]
);

export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ticketId: text('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    titleFa: text('title_fa').notNull(),
    bodyFa: text('body_fa').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('notifications_recipient_read_idx').on(
      table.recipientUserId,
      table.isRead,
      table.createdAt
    ),
  ]
);

// ============================================================================
// Drizzle Relations
// ============================================================================

export const usersRelations = relations(users, ({ one, many }) => ({
  sessions: many(authSessions),
  accounts: many(authAccounts),
  userRoles: many(userRoles),
  permissionOverrides: many(userPermissionOverrides),
  departmentMemberships: many(departmentMemberships),
  availability: one(operatorAvailability, {
    fields: [users.id],
    references: [operatorAvailability.userId],
  }),
  assignedTickets: many(tickets),
  notifications: many(notifications),
  auditLogs: many(auditLogs),
}));

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, {
    fields: [authSessions.userId],
    references: [users.id],
  }),
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, {
    fields: [authAccounts.userId],
    references: [users.id],
  }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
  rolePermissions: many(rolePermissions),
}));

export const permissionsRelations = relations(permissions, ({ many }) => ({
  rolePermissions: many(rolePermissions),
  userPermissionOverrides: many(userPermissionOverrides),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, {
    fields: [rolePermissions.roleId],
    references: [roles.id],
  }),
  permission: one(permissions, {
    fields: [rolePermissions.permissionId],
    references: [permissions.id],
  }),
}));

export const userPermissionOverridesRelations = relations(userPermissionOverrides, ({ one }) => ({
  user: one(users, {
    fields: [userPermissionOverrides.userId],
    references: [users.id],
  }),
  permission: one(permissions, {
    fields: [userPermissionOverrides.permissionId],
    references: [permissions.id],
  }),
}));

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  memberships: many(departmentMemberships),
  aiSettings: one(aiDepartmentSettings, {
    fields: [departments.id],
    references: [aiDepartmentSettings.departmentId],
  }),
  routingState: one(departmentRoutingState, {
    fields: [departments.id],
    references: [departmentRoutingState.departmentId],
  }),
  knowledgeCollections: many(departmentKnowledgeCollections),
  tickets: many(tickets),
}));

export const departmentMembershipsRelations = relations(departmentMemberships, ({ one }) => ({
  department: one(departments, {
    fields: [departmentMemberships.departmentId],
    references: [departments.id],
  }),
  user: one(users, {
    fields: [departmentMemberships.userId],
    references: [users.id],
  }),
}));

export const operatorAvailabilityRelations = relations(operatorAvailability, ({ one }) => ({
  user: one(users, {
    fields: [operatorAvailability.userId],
    references: [users.id],
  }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, {
    fields: [auditLogs.actorUserId],
    references: [users.id],
  }),
}));

export const knowledgeDocumentsRelations = relations(knowledgeDocuments, ({ one, many }) => ({
  collection: one(knowledgeCollections, {
    fields: [knowledgeDocuments.collectionId],
    references: [knowledgeCollections.id],
  }),
  chunks: many(knowledgeChunks),
  versions: many(knowledgeDocumentVersions),
  departments: many(knowledgeDocumentDepartments),
}));

export const knowledgeChunksRelations = relations(knowledgeChunks, ({ one }) => ({
  document: one(knowledgeDocuments, {
    fields: [knowledgeChunks.documentId],
    references: [knowledgeDocuments.id],
  }),
}));

export const knowledgeQaEntriesRelations = relations(knowledgeQaEntries, ({ one, many }) => ({
  collection: one(knowledgeCollections, {
    fields: [knowledgeQaEntries.collectionId],
    references: [knowledgeCollections.id],
  }),
  departments: many(knowledgeQaDepartments),
}));

export const aiConversationsRelations = relations(aiConversations, ({ one, many }) => ({
  department: one(departments, {
    fields: [aiConversations.departmentId],
    references: [departments.id],
  }),
  messages: many(aiMessages),
  retrievalRecords: many(knowledgeRetrievalRecords),
}));

export const aiMessagesRelations = relations(aiMessages, ({ one }) => ({
  conversation: one(aiConversations, {
    fields: [aiMessages.conversationId],
    references: [aiConversations.id],
  }),
}));

export const customerProfilesRelations = relations(customerProfiles, ({ many }) => ({
  sessions: many(customerSessions),
  tickets: many(tickets),
}));

export const customerSessionsRelations = relations(customerSessions, ({ one }) => ({
  customer: one(customerProfiles, {
    fields: [customerSessions.customerProfileId],
    references: [customerProfiles.id],
  }),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  customer: one(customerProfiles, {
    fields: [tickets.customerProfileId],
    references: [customerProfiles.id],
  }),
  department: one(departments, {
    fields: [tickets.departmentId],
    references: [departments.id],
  }),
  assignedOperator: one(users, {
    fields: [tickets.assignedOperatorId],
    references: [users.id],
  }),
  linkedAiConversation: one(aiConversations, {
    fields: [tickets.linkedAiConversationId],
    references: [aiConversations.id],
  }),
  messages: many(ticketMessages),
  attachments: many(ticketAttachments),
  assignments: many(ticketAssignments),
  statusHistory: many(ticketStatusHistory),
  activities: many(ticketActivity),
}));

export const ticketMessagesRelations = relations(ticketMessages, ({ one, many }) => ({
  ticket: one(tickets, {
    fields: [ticketMessages.ticketId],
    references: [tickets.id],
  }),
  attachments: many(ticketAttachments),
}));

export const ticketAttachmentsRelations = relations(ticketAttachments, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketAttachments.ticketId],
    references: [tickets.id],
  }),
  message: one(ticketMessages, {
    fields: [ticketAttachments.messageId],
    references: [ticketMessages.id],
  }),
}));

export const ticketAssignmentsRelations = relations(ticketAssignments, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketAssignments.ticketId],
    references: [tickets.id],
  }),
}));

export const ticketStatusHistoryRelations = relations(ticketStatusHistory, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketStatusHistory.ticketId],
    references: [tickets.id],
  }),
}));

export const ticketActivityRelations = relations(ticketActivity, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketActivity.ticketId],
    references: [tickets.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, {
    fields: [notifications.recipientUserId],
    references: [users.id],
  }),
  ticket: one(tickets, {
    fields: [notifications.ticketId],
    references: [tickets.id],
  }),
}));

// ============================================================================
// Phase 5: Shared File Hub (Folders, Stored Files, Versions, Granular Permissions)
// ============================================================================

export const fileFolders = pgTable(
  'file_folders',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    parentFolderId: text('parent_folder_id').references((): AnyPgColumn => fileFolders.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    ownerLabel: text('owner_label'),
    accessPolicy: text('access_policy').notNull().default('department_only'), // department_only | shared_read_all_departments
    createdByUserId: text('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('file_folders_dept_parent_idx').on(table.departmentId, table.parentFolderId),
    index('file_folders_dept_policy_idx').on(table.departmentId, table.accessPolicy),
  ]
);

export const storedFiles = pgTable(
  'stored_files',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => fileFolders.id, {
      onDelete: 'set null',
    }),
    uploadedByUserId: text('uploaded_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    originalFilename: text('original_filename').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    fileExtension: text('file_extension').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    scanStatus: text('scan_status').notNull().default('skipped'), // skipped | clean | quarantined
    versionNumber: integer('version_number').notNull().default(1),
    accessPolicy: text('access_policy').notNull().default('inherit'), // inherit | department_only | shared_read_all_departments
    downloadCount: integer('download_count').notNull().default(0),
    lastDownloadedAt: timestamp('last_downloaded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('stored_files_storage_key_unique_idx').on(table.storageKey),
    index('stored_files_dept_folder_idx').on(table.departmentId, table.folderId, table.createdAt),
    index('stored_files_uploader_idx').on(table.uploadedByUserId),
    index('stored_files_policy_idx').on(table.accessPolicy),
  ]
);

export const fileVersions = pgTable(
  'file_versions',
  {
    id: text('id').primaryKey(),
    fileId: text('file_id')
      .notNull()
      .references(() => storedFiles.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    originalFilename: text('original_filename').notNull(),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type').notNull(),
    fileExtension: text('file_extension').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    replacedByUserId: text('replaced_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    changeNote: text('change_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('file_versions_storage_key_unique_idx').on(table.storageKey),
    index('file_versions_file_ver_idx').on(table.fileId, table.versionNumber),
  ]
);

export const filePermissions = pgTable(
  'file_permissions',
  {
    id: text('id').primaryKey(),
    departmentId: text('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => fileFolders.id, {
      onDelete: 'cascade',
    }),
    fileId: text('file_id').references(() => storedFiles.id, {
      onDelete: 'cascade',
    }),
    targetType: text('target_type').notNull(), // user | department
    targetId: text('target_id').notNull(),
    canView: boolean('can_view').notNull().default(true),
    canDownload: boolean('can_download').notNull().default(true),
    canUpload: boolean('can_upload').notNull().default(false),
    canManage: boolean('can_manage').notNull().default(false),
    note: text('note'),
    grantedByUserId: text('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('file_permissions_dept_target_idx').on(
      table.departmentId,
      table.targetType,
      table.targetId
    ),
    index('file_permissions_folder_idx').on(table.folderId),
    index('file_permissions_file_idx').on(table.fileId),
  ]
);

export const fileFoldersRelations = relations(fileFolders, ({ one, many }) => ({
  department: one(departments, {
    fields: [fileFolders.departmentId],
    references: [departments.id],
  }),
  parent: one(fileFolders, {
    fields: [fileFolders.parentFolderId],
    references: [fileFolders.id],
    relationName: 'folderHierarchy',
  }),
  children: many(fileFolders, { relationName: 'folderHierarchy' }),
  files: many(storedFiles),
  permissions: many(filePermissions),
}));

export const storedFilesRelations = relations(storedFiles, ({ one, many }) => ({
  department: one(departments, {
    fields: [storedFiles.departmentId],
    references: [departments.id],
  }),
  folder: one(fileFolders, {
    fields: [storedFiles.folderId],
    references: [fileFolders.id],
  }),
  uploadedBy: one(users, {
    fields: [storedFiles.uploadedByUserId],
    references: [users.id],
  }),
  versions: many(fileVersions),
  permissions: many(filePermissions),
}));

export const fileVersionsRelations = relations(fileVersions, ({ one }) => ({
  file: one(storedFiles, {
    fields: [fileVersions.fileId],
    references: [storedFiles.id],
  }),
  replacedBy: one(users, {
    fields: [fileVersions.replacedByUserId],
    references: [users.id],
  }),
}));

export const filePermissionsRelations = relations(filePermissions, ({ one }) => ({
  department: one(departments, {
    fields: [filePermissions.departmentId],
    references: [departments.id],
  }),
  folder: one(fileFolders, {
    fields: [filePermissions.folderId],
    references: [fileFolders.id],
  }),
  file: one(storedFiles, {
    fields: [filePermissions.fileId],
    references: [storedFiles.id],
  }),
}));


