CREATE TABLE `occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`slot_id` text,
	`ritual_id` integer,
	`date` text NOT NULL,
	`end_date` text,
	`start_time` text,
	`duration_min` integer,
	`title_override` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`owner_user_id` text,
	`facilitator` text,
	`guest_name` text,
	`notes` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`edited_at` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ritual_id`) REFERENCES `rituals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `occurrences_plan_date_idx` ON `occurrences` (`plan_id`,`date`);--> statement-breakpoint
CREATE INDEX `occurrences_slot_idx` ON `occurrences` (`slot_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`name` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`ics_token` text,
	`from_template_id` text,
	`primary_job_id` integer,
	`created_by` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`primary_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `plans_team_idx` ON `plans` (`team_id`);--> statement-breakpoint
CREATE TABLE `reflections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`occurrence_id` text NOT NULL,
	`rating` integer,
	`what_worked` text,
	`what_didnt` text,
	`author_user_id` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`occurrence_id`) REFERENCES `occurrences`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reflections_occurrence_idx` ON `reflections` (`occurrence_id`);--> statement-breakpoint
CREATE TABLE `rotation_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slot_id` text NOT NULL,
	`position` integer NOT NULL,
	`ritual_id` integer,
	`label` text,
	FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ritual_id`) REFERENCES `rituals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rotation_items_slot_position_idx` ON `rotation_items` (`slot_id`,`position`);--> statement-breakpoint
CREATE TABLE `slots` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`freq` text DEFAULT 'weekly' NOT NULL,
	`byweekday` integer NOT NULL,
	`nth` integer,
	`start_time` text,
	`duration_min` integer,
	`cycle_length` integer DEFAULT 1 NOT NULL,
	`anchor_date` text NOT NULL,
	`active_from` text,
	`active_to` text,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `slots_plan_idx` ON `slots` (`plan_id`);