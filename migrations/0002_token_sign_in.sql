ALTER TABLE `api_tokens` ADD `can_sign_in` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `token_id` integer REFERENCES api_tokens(id);--> statement-breakpoint
ALTER TABLE `sessions` ADD `reauth_at` integer;