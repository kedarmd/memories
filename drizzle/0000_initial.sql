CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  git_root TEXT UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, objective),
  UNIQUE(project_id, id)
);
CREATE INDEX tasks_project_id_index ON tasks(project_id);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'saved' CHECK (status = 'saved'),
  summary TEXT NOT NULL,
  details TEXT NOT NULL,
  session_agent TEXT NOT NULL,
  session_id TEXT,
  workspace TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(project_id, task_id) REFERENCES tasks(project_id, id) ON DELETE CASCADE,
  UNIQUE(project_id, task_id, dedupe_key),
  UNIQUE(project_id, task_id, id)
);
CREATE INDEX checkpoints_scope_created_index ON checkpoints(project_id, task_id, created_at);
