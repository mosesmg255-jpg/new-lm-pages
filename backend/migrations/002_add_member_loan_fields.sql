-- Migration: Add loanTaken, loanPaid, loanUnpaid columns to members table

ALTER TABLE `members` ADD COLUMN IF NOT EXISTS `loanTaken` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `members` ADD COLUMN IF NOT EXISTS `loanPaid` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `members` ADD COLUMN IF NOT EXISTS `loanUnpaid` TINYINT(1) NOT NULL DEFAULT 1;
