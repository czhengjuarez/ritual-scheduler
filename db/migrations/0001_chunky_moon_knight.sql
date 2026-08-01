CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text,
	`icon` text,
	`description` text,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`typical_span` text DEFAULT 'ongoing' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_slug_unique` ON `jobs` (`slug`);--> statement-breakpoint
CREATE TABLE `ritual_jobs` (
	`ritual_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`weight` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`ritual_id`) REFERENCES `rituals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ritual_jobs_ritual_job_idx` ON `ritual_jobs` (`ritual_id`,`job_id`);--> statement-breakpoint
CREATE TABLE `rituals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`purpose` text,
	`category_id` integer,
	`visibility` text DEFAULT 'public' NOT NULL,
	`status` text DEFAULT 'published' NOT NULL,
	`owner_team_id` text,
	`created_by` text,
	`engagement` text DEFAULT 'recurring' NOT NULL,
	`span_weeks` integer,
	`default_cadence` text DEFAULT 'adhoc' NOT NULL,
	`duration_min` integer,
	`prep_lead_days` integer,
	`load` text DEFAULT 'medium' NOT NULL,
	`participants` text,
	`size_min` integer,
	`size_max` integer,
	`format` text DEFAULT 'sync' NOT NULL,
	`timing_hint` text,
	`min_gap_weeks` integer,
	`pairs_well_with` text DEFAULT '[]',
	`avoid_near` text DEFAULT '[]',
	`depends_on` text,
	`facilitator_role` text,
	`prep_notes` text,
	`agenda` text DEFAULT '[]',
	`outputs` text DEFAULT '[]',
	`materials` text DEFAULT '[]',
	`anti_patterns` text DEFAULT '[]',
	`variations` text DEFAULT '[]',
	`tags` text DEFAULT '[]',
	`source_name` text,
	`source_url` text,
	`attribution` text,
	`source_verified` integer DEFAULT false NOT NULL,
	`cover_key` text,
	`embedding_version` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rituals_slug_unique` ON `rituals` (`slug`);--> statement-breakpoint
CREATE INDEX `rituals_category_idx` ON `rituals` (`category_id`);--> statement-breakpoint
CREATE INDEX `rituals_status_idx` ON `rituals` (`status`);--> statement-breakpoint
CREATE INDEX `rituals_visibility_idx` ON `rituals` (`visibility`);--> statement-breakpoint
CREATE INDEX `rituals_engagement_idx` ON `rituals` (`engagement`);