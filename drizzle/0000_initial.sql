CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`status` text DEFAULT 'saved' NOT NULL,
	`summary` text NOT NULL,
	`details` text NOT NULL,
	`session_agent` text NOT NULL,
	`session_id` text,
	`workspace` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`,`task_id`) REFERENCES `tasks`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoints_scope_dedupe_unique` ON `checkpoints` (`project_id`,`task_id`,`dedupe_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `checkpoints_scope_id_unique` ON `checkpoints` (`project_id`,`task_id`,`id`);--> statement-breakpoint
CREATE INDEX `checkpoints_scope_created_index` ON `checkpoints` (`project_id`,`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`git_root` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_git_root_unique` ON `projects` (`git_root`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`objective` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_objective_unique` ON `tasks` (`project_id`,`objective`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_id_id_unique` ON `tasks` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `tasks_project_id_index` ON `tasks` (`project_id`);