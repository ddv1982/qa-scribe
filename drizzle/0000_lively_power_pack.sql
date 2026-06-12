CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`generation_context_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`entry_id` text,
	`filename` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`relative_path` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`ai_run_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_run_id`) REFERENCES `ai_runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text,
	`body` text NOT NULL,
	`metadata_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`excluded_from_generation` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `evidence_links` (
	`id` text PRIMARY KEY NOT NULL,
	`finding_id` text NOT NULL,
	`entry_id` text,
	`attachment_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `generation_context_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_context_id` text NOT NULL,
	`entry_id` text NOT NULL,
	`included` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`generation_context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`entry_id`) REFERENCES `entries`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `generation_contexts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`test_target` text,
	`charter` text,
	`environment` text,
	`build_version` text,
	`related_reference` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_opened_at` text NOT NULL
);
