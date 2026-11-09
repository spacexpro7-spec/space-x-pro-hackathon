ALTER TABLE `settings` ADD COLUMN `whatsapp_number` text;
--> statement-breakpoint
ALTER TABLE `settings` ADD COLUMN `registration_fee_inr` integer;
--> statement-breakpoint
ALTER TABLE `participants` ADD COLUMN `phone` text;
