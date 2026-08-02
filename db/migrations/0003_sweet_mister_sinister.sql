CREATE TABLE `cadence_jobs` (
	`cadence_template_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	FOREIGN KEY (`cadence_template_id`) REFERENCES `cadence_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cadence_jobs_template_job_idx` ON `cadence_jobs` (`cadence_template_id`,`job_id`);--> statement-breakpoint
CREATE TABLE `cadence_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`summary` text,
	`visibility` text DEFAULT 'public' NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`owner_team_id` text,
	`origin_plan_id` text,
	`created_by` text,
	`duration_weeks` integer NOT NULL,
	`discipline` text,
	`team_size_min` integer,
	`team_size_max` integer,
	`work_mode` text,
	`goals` text DEFAULT '[]',
	`definition` text NOT NULL,
	`source_name` text,
	`source_url` text,
	`clone_count` integer DEFAULT 0 NOT NULL,
	`featured` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`owner_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`origin_plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cadence_templates_slug_unique` ON `cadence_templates` (`slug`);--> statement-breakpoint
CREATE INDEX `cadence_templates_status_idx` ON `cadence_templates` (`status`);--> statement-breakpoint
CREATE INDEX `cadence_templates_visibility_idx` ON `cadence_templates` (`visibility`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`ics_token` text,
	`from_template_id` integer,
	`primary_job_id` integer,
	`created_by` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_template_id`) REFERENCES `cadence_templates`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_plans`("id", "team_id", "name", "start_date", "end_date", "timezone", "status", "ics_token", "from_template_id", "primary_job_id", "created_by", "created_at") SELECT "id", "team_id", "name", "start_date", "end_date", "timezone", "status", "ics_token", "from_template_id", "primary_job_id", "created_by", "created_at" FROM `plans`;--> statement-breakpoint
DROP TABLE `plans`;--> statement-breakpoint
ALTER TABLE `__new_plans` RENAME TO `plans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `plans_team_idx` ON `plans` (`team_id`);