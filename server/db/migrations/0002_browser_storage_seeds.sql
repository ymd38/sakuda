ALTER TABLE `sites` ADD `discovery_seed_paths` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `sites` ADD `browser_storage_enc` blob;--> statement-breakpoint
ALTER TABLE `sites` ADD `browser_storage_names` text DEFAULT '[]' NOT NULL;