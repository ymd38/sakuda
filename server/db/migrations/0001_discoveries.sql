CREATE TABLE `discoveries` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`status` text NOT NULL,
	`urls` text NOT NULL,
	`meta` text NOT NULL,
	`warnings` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discoveries_site_created_idx` ON `discoveries` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `discoveries_status_idx` ON `discoveries` (`status`);