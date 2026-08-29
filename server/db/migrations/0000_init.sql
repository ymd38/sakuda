CREATE TABLE `engine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`engine` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`exit_code` integer,
	`signal` text,
	`counts` text NOT NULL,
	`meta` text NOT NULL,
	`warnings` text NOT NULL,
	`error` text,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `engine_runs_scan_idx` ON `engine_runs` (`scan_id`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`engine_run_id` text NOT NULL,
	`engine` text NOT NULL,
	`rule_id` text NOT NULL,
	`name` text NOT NULL,
	`severity` text NOT NULL,
	`url` text NOT NULL,
	`method` text,
	`param` text,
	`evidence` text,
	`description` text,
	`solution` text,
	`reference` text,
	`fingerprint` text NOT NULL,
	`raw` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`engine_run_id`) REFERENCES `engine_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `findings_scan_idx` ON `findings` (`scan_id`);--> statement-breakpoint
CREATE INDEX `findings_scan_fp_idx` ON `findings` (`scan_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`site_id` text NOT NULL,
	`status` text NOT NULL,
	`engines` text NOT NULL,
	`site_snapshot` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`site_id`) REFERENCES `sites`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scans_site_created_idx` ON `scans` (`site_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `scans_status_idx` ON `scans` (`status`);--> statement-breakpoint
CREATE TABLE `sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`front_base_url` text NOT NULL,
	`api_base_url` text,
	`nuclei_paths` text NOT NULL,
	`openapi_url` text,
	`openapi_json` text,
	`zap_fe_seed_path` text NOT NULL,
	`exclude_paths` text NOT NULL,
	`nuclei_rate_limit` integer NOT NULL,
	`zap_api_max_minutes` integer NOT NULL,
	`zap_fe_spider_max_minutes` integer NOT NULL,
	`non_local_confirmed` integer NOT NULL,
	`headers_enc` blob,
	`header_names` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
