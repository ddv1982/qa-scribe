CREATE TABLE `generation_context_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_context_id` text NOT NULL,
	`attachment_id` text NOT NULL,
	`included` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`generation_context_id`) REFERENCES `generation_contexts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `ai_runs` ADD `reasoning_effort` text;--> statement-breakpoint
ALTER TABLE `findings` ADD `metadata_json` text;