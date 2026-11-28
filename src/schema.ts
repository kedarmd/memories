import { foreignKey, index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  gitRoot: text('git_root'),
  createdAt: text('created_at').notNull(),
}, (table) => [uniqueIndex('projects_git_root_unique').on(table.gitRoot)]);

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  objective: text('objective').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('tasks_project_objective_unique').on(table.projectId, table.objective),
  uniqueIndex('tasks_project_id_id_unique').on(table.projectId, table.id),
  index('tasks_project_id_index').on(table.projectId),
]);

export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  taskId: text('task_id').notNull(),
  dedupeKey: text('dedupe_key').notNull(),
  status: text('status', { enum: ['saved'] }).notNull().default('saved'),
  summary: text('summary').notNull(),
  details: text('details').notNull(),
  sessionAgent: text('session_agent').notNull(),
  sessionId: text('session_id'),
  workspace: text('workspace').notNull(),
  coverage: text('coverage').notNull().default('{"status":"unknown","notes":"Migration backfill; coverage was not recorded."}'),
  sources: text('sources').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
}, (table) => [
  uniqueIndex('checkpoints_scope_dedupe_unique').on(table.projectId, table.taskId, table.dedupeKey),
  uniqueIndex('checkpoints_scope_id_unique').on(table.projectId, table.taskId, table.id),
  index('checkpoints_scope_created_index').on(table.projectId, table.taskId, table.createdAt),
  foreignKey({ columns: [table.projectId, table.taskId], foreignColumns: [tasks.projectId, tasks.id], name: 'checkpoints_task_project_fk' }).onDelete('cascade'),
]);
