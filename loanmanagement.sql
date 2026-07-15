-- ============================================================
-- SQL script for phpMyAdmin: loanmanagement database + all tables
-- Updated: Full schema supporting all portal sections (1-7)
-- ============================================================

CREATE DATABASE IF NOT EXISTS `loanmanagement`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE `loanmanagement`;

-- =========================
-- Admins (PHP login/register)
-- =========================
CREATE TABLE IF NOT EXISTS `admins` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `full_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `phone` VARCHAR(50) DEFAULT '',
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Members (pending queue - Sequelize model)
-- =========================
CREATE TABLE IF NOT EXISTS `members` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `full_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `phone` VARCHAR(50) NOT NULL DEFAULT '',
  `password_hash` VARCHAR(255) NOT NULL,
  `status` ENUM('pending','approved','denied') NOT NULL DEFAULT 'pending',
  `approved` TINYINT(1) NOT NULL DEFAULT 0,
  `loanAmount` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `savingsAmount` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `loanTaken` TINYINT(1) NOT NULL DEFAULT 0,
  `loanPaid` TINYINT(1) NOT NULL DEFAULT 0,
  `loanUnpaid` TINYINT(1) NOT NULL DEFAULT 1,
  `transaction_pin` VARCHAR(255) NULL,
  `security_pin` VARCHAR(10) NULL,
  `admin_id` VARCHAR(50) NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_members_status` (`status`),
  KEY `idx_members_email` (`email`),
  KEY `idx_members_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Approved Members Pool (verified access)
-- =========================
CREATE TABLE IF NOT EXISTS `approved_members` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `full_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `phone` VARCHAR(50) NOT NULL DEFAULT '',
  `password` VARCHAR(255) NOT NULL,
  `loanAmount` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `savingsAmount` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `admin_phone` VARCHAR(50) DEFAULT NULL,
  `admin_email` VARCHAR(150) DEFAULT NULL,
  `admin_name` VARCHAR(100) DEFAULT NULL,
  `transaction_pin` VARCHAR(255) NULL,
  `security_pin` VARCHAR(10) NULL,
  `verified_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_approved_email` (`email`),
  KEY `idx_approved_members_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Deleted Members Recovery
-- =========================
CREATE TABLE IF NOT EXISTS `deleted_members` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `original_id` INT UNSIGNED NOT NULL,
  `full_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(50) NOT NULL DEFAULT '',
  `password` VARCHAR(255) NOT NULL,
  `transaction_pin` VARCHAR(255) NULL,
  `security_pin` VARCHAR(10) NULL,
  `loanAmount` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `savingsAmount` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `deleted_by` VARCHAR(100) NOT NULL DEFAULT 'admin',
  `deleted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_deleted_members_original` (`original_id`),
  KEY `idx_deleted_members_email` (`email`),
  KEY `idx_deleted_members_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Denied / Flagged Accounts
-- =========================
CREATE TABLE IF NOT EXISTS `denied_access` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `full_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL,
  `phone` VARCHAR(50) NOT NULL DEFAULT '',
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `denied_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `restriction_reason` VARCHAR(255) NOT NULL DEFAULT 'Admin denied',
  PRIMARY KEY (`id`),
  KEY `idx_denied_access_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Password Recovery Tokens
-- =========================
CREATE TABLE IF NOT EXISTS `password_reset_temp` (
  `email` VARCHAR(250) NOT NULL,
  `token` VARCHAR(255) NOT NULL,
  `expiry` DATETIME NOT NULL,
  KEY `idx_pwd_reset_token` (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Loans (Section 2 - Loans Dashboard)
-- =========================
CREATE TABLE IF NOT EXISTS `loans` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `borrower_id` INT UNSIGNED NOT NULL,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `borrower_name` VARCHAR(150) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `duration` INT NOT NULL DEFAULT 0,
  `interest_rate` DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('Active','Settled','Approved','Disbursed','Overdue','Denied') NOT NULL DEFAULT 'Active',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_loans_borrower_id` (`borrower_id`),
  KEY `idx_loans_status` (`status`),
  KEY `idx_loans_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Repayments (Section 3 - Repayments Ledger)
-- =========================
CREATE TABLE IF NOT EXISTS `repayments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `loan_id` INT UNSIGNED NOT NULL,
  `member_id` INT UNSIGNED NOT NULL,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `member_name` VARCHAR(150) NOT NULL DEFAULT '',
  `amount` DECIMAL(18,2) NOT NULL,
  `payment_method` VARCHAR(100) NOT NULL DEFAULT '',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_repayments_loan_id` (`loan_id`),
  KEY `idx_repayments_member_id` (`member_id`),
  KEY `idx_repayments_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Member Savings
-- =========================
CREATE TABLE IF NOT EXISTS `member_savings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `member_id` INT UNSIGNED NOT NULL,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `member_name` VARCHAR(150) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_member_savings_member_id` (`member_id`),
  KEY `idx_member_savings_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Contributions
-- =========================
CREATE TABLE IF NOT EXISTS `contributions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `member_id` INT UNSIGNED NOT NULL,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `member_name` VARCHAR(150) NOT NULL DEFAULT '',
  `amount` DECIMAL(18,2) NOT NULL,
  `payment_method` VARCHAR(100) NOT NULL,
  `receipt_url` VARCHAR(255) NULL,
  `status` VARCHAR(100) NOT NULL DEFAULT 'Pending Head Treasurer Reconciliation',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_contributions_member_id` (`member_id`),
  KEY `idx_contributions_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Expense Claims
-- =========================
CREATE TABLE IF NOT EXISTS `expense_claims` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `member_id` INT UNSIGNED NOT NULL,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `category` VARCHAR(150) NOT NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `receipt_url` VARCHAR(255) NOT NULL,
  `status` VARCHAR(100) NOT NULL DEFAULT 'Pending Authorization',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_expense_claims_member_id` (`member_id`),
  KEY `idx_expense_claims_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Transaction Verifications
-- =========================
CREATE TABLE IF NOT EXISTS `transaction_verifications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `member_id` INT UNSIGNED NOT NULL,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `member_name` VARCHAR(150) NOT NULL,
  `email` VARCHAR(150) NOT NULL DEFAULT '',
  `phone` VARCHAR(50) NOT NULL DEFAULT '',
  `security_pin` VARCHAR(10) NOT NULL DEFAULT '',
  `transaction_type` ENUM('loan_request','loan_assignment','repayment') NOT NULL DEFAULT 'loan_request',
  `amount` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `duration` INT UNSIGNED DEFAULT 0,
  `interest_rate` DECIMAL(8,2) DEFAULT 0.00,
  `extra_data` JSON DEFAULT NULL,
  `status` ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_verifications_status` (`status`),
  KEY `idx_verifications_member` (`member_id`),
  KEY `idx_verifications_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- App Settings
-- =========================
CREATE TABLE IF NOT EXISTS `app_settings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `setting_key` VARCHAR(100) NOT NULL UNIQUE,
  `setting_value` MEDIUMTEXT NOT NULL,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Meeting Minutes Registry
-- =========================
CREATE TABLE IF NOT EXISTS `meeting_minutes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `date` DATE NOT NULL,
  `venue` VARCHAR(255),
  `chair` VARCHAR(255),
  `attendees` TEXT,
  `agenda` TEXT,
  `body` TEXT,
  `next_meeting_date` DATE,
  `secretary` VARCHAR(255),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_meeting_minutes_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- System Logs (Section 4 - System Logs / Notifications)
-- =========================
CREATE TABLE IF NOT EXISTS `system_logs` (
  `id` VARCHAR(64) NOT NULL,
  `message` TEXT NOT NULL,
  `timestamp_str` VARCHAR(100) NOT NULL,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_logs_created` (`created_at`),
  KEY `idx_system_logs_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Chama Subsidiaries (Section 2 - Treasurer Console)
-- =========================
CREATE TABLE IF NOT EXISTS `chama_subsidiaries` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `slug` VARCHAR(100) NOT NULL,
  `display_name` VARCHAR(255) NOT NULL,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_chama_subsidiaries_admin` (`admin_id`),
  UNIQUE KEY `uniq_chama_subsidiaries_admin_slug` (`admin_id`, `slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Default subsidiaries seed data
INSERT IGNORE INTO `chama_subsidiaries` (`slug`, `display_name`) VALUES
  ('eldoret_main', 'Eldoret Main Central Chama'),
  ('kapsoya_branch', 'Kapsoya Estate Sub-Group'),
  ('huruma_dev', 'Huruma Development Circle');

-- =========================
-- Resolution Votes (Section 2 - Treasurer Console, Voting Portal)
-- =========================
CREATE TABLE IF NOT EXISTS `resolution_votes` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `vote_type` ENUM('Approve','Abstain','Reject') NOT NULL,
  `subsidiary_slug` VARCHAR(100) NOT NULL DEFAULT 'eldoret_main',
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `cast_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_votes_subsidiary` (`subsidiary_slug`),
  KEY `idx_resolution_votes_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Automation Admin Emails (Section 5 - Automation)
-- =========================
CREATE TABLE IF NOT EXISTS `automation_admins` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `registered_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_automation_admins_admin` (`admin_id`),
  UNIQUE KEY `uniq_automation_admins_admin_email` (`admin_id`, `email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- =========================
-- Scheduled Meetings (Section 5 - Automation)
-- =========================
CREATE TABLE IF NOT EXISTS `scheduled_meetings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `meeting_date` DATE NOT NULL,
  `meeting_time` TIME NOT NULL,
  `location` VARCHAR(500) NOT NULL DEFAULT '',
  `platform` VARCHAR(100) NOT NULL DEFAULT 'Email Engine',
  `target_group` VARCHAR(100) NOT NULL DEFAULT 'all',
  `subsidiary_slug` VARCHAR(100) NOT NULL DEFAULT 'eldoret_main',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scheduled_meetings_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- SAMPLE DATA: Mirrors exactly what is shown in the portal demo
-- ============================================================

-- Sample approved members with balances (matches Repayments Ledger demo)
INSERT IGNORE INTO `approved_members` (`full_name`, `email`, `phone`, `password`, `loanAmount`, `savingsAmount`) VALUES
  ('Kipchumba Kiprop',  'kipchumba@chama.local', '+254700000001', '$2a$10$X8QxX.X8QxX8QxX8QxX8QxX8QxX8QxX8QxX8QxX8QxX8QxX8', 12000.00, 5000.00),
  ('Chepngetich Janet', 'janet@chama.local',     '+254700000002', '$2a$10$X8QxX.X8QxX8QxX8QxX8QxX8QxX8QxX8QxX8QxX8QxX8QxX8', 45000.00, 10000.00),
  ('Mwangi David',      'david@chama.local',     '+254700000003', '$2a$10$X8QxX.X8QxX8QxX8QxX8QxX8QxX8QxX8QxX8QxX8QxX8QxX8',     0.00, 25000.00);

-- ============================================================
-- DASHBOARD TILE COUNTS VIEW (used by Control Sector)
-- Run: SELECT * FROM v_dashboard_stats;
-- ============================================================
CREATE OR REPLACE VIEW `v_dashboard_stats` AS
SELECT
  (SELECT COUNT(*) FROM loans WHERE status = 'Active')                         AS loan_applications,
  (SELECT COUNT(*) FROM loans WHERE status = 'Approved')                       AS approved_loans,
  (SELECT COUNT(*) FROM loans WHERE status = 'Disbursed')                      AS disbursed_loans,
  (SELECT COUNT(*) FROM repayments)                                             AS repayment_records,
  (SELECT COUNT(*) FROM loans WHERE status = 'Overdue')                        AS overdue_loans,
  (SELECT COUNT(*) FROM approved_members)                                       AS borrowers,
  (SELECT COUNT(DISTINCT borrower_name) FROM loans)                             AS loan_products,
  (SELECT COUNT(*) FROM admins)                                                 AS users;

-- ============================================================
-- CORPORATE PORTAL SCHEMA (SHMS FEATURES WITH S3 & OPTIMISTIC LOCKS)
-- ============================================================

-- 1. Corporate Users & Roles
CREATE TABLE IF NOT EXISTS `corporate_users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `full_name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(150) NOT NULL UNIQUE,
  `role` ENUM('Executive', 'Secretary', 'Admin') NOT NULL,
  `status` ENUM('Available', 'Busy', 'Away', 'Offline') NOT NULL DEFAULT 'Offline',
  `skills` VARCHAR(255) DEFAULT 'general',
  `current_workload` INT UNSIGNED DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_corporate_users_admin` (`admin_id`),
  KEY `idx_corp_users_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Tasks & Automatic Routing
CREATE TABLE IF NOT EXISTS `corporate_tasks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `title` VARCHAR(255) NOT NULL,
  `description` TEXT,
  `priority` ENUM('Low', 'Medium', 'High', 'Critical') DEFAULT 'Medium',
  `status` ENUM('Unassigned', 'Assigned', 'In_Progress', 'Completed', 'Escalated') DEFAULT 'Unassigned',
  `creator_id` INT UNSIGNED NOT NULL,
  `assignee_id` INT UNSIGNED DEFAULT NULL,
  `idempotency_key` VARCHAR(100) UNIQUE NOT NULL,
  `sla_deadline` DATETIME NOT NULL,
  `version` INT UNSIGNED DEFAULT 1, -- Optimistic locking field
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`creator_id`) REFERENCES `corporate_users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`assignee_id`) REFERENCES `corporate_users`(`id`) ON DELETE SET NULL,
  KEY `idx_corporate_tasks_admin` (`admin_id`),
  KEY `idx_corp_tasks_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Room Bookings (Calendar Coordination)
CREATE TABLE IF NOT EXISTS `corporate_rooms` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `name` VARCHAR(100) NOT NULL,
  `capacity` INT UNSIGNED NOT NULL,
  `location` VARCHAR(150) DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_corporate_rooms_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `corporate_bookings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `room_id` INT UNSIGNED NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `organizer_id` INT UNSIGNED NOT NULL,
  `start_time` DATETIME NOT NULL,
  `end_time` DATETIME NOT NULL,
  `timezone` VARCHAR(100) DEFAULT 'UTC',
  `version` INT UNSIGNED DEFAULT 1, -- Optimistic locking field
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`room_id`) REFERENCES `corporate_rooms`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`organizer_id`) REFERENCES `corporate_users`(`id`) ON DELETE CASCADE,
  KEY `idx_corporate_bookings_admin` (`admin_id`),
  INDEX `idx_corp_booking_overlap` (`room_id`, `start_time`, `end_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Document Control (AWS S3-backed)
CREATE TABLE IF NOT EXISTS `corporate_documents` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `s3_bucket` VARCHAR(100) NOT NULL,
  `s3_key` VARCHAR(512) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 1, -- Optimistic locking field
  `is_locked` TINYINT(1) DEFAULT 0,
  `locked_by_id` INT UNSIGNED DEFAULT NULL,
  `hash_checksum` VARCHAR(64) NOT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`locked_by_id`) REFERENCES `corporate_users`(`id`) ON DELETE SET NULL,
  KEY `idx_corporate_documents_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `corporate_signatures` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `document_id` INT UNSIGNED NOT NULL,
  `signer_id` INT UNSIGNED NOT NULL,
  `signature_payload` TEXT NOT NULL,
  `signed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`document_id`) REFERENCES `corporate_documents`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`signer_id`) REFERENCES `corporate_users`(`id`) ON DELETE CASCADE,
  KEY `idx_corporate_signatures_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Consolidated Communication Feed
CREATE TABLE IF NOT EXISTS `corporate_communications` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `source` ENUM('Email', 'Phone', 'Visitor', 'Chat') NOT NULL,
  `sender` VARCHAR(150) NOT NULL,
  `subject` VARCHAR(255) DEFAULT NULL,
  `content` TEXT,
  `is_resolved` TINYINT(1) DEFAULT 0,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_corporate_communications_admin` (`admin_id`),
  KEY `idx_corp_comm_src` (`source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Travel & Expenses (AWS S3-backed receipts)
CREATE TABLE IF NOT EXISTS `corporate_travel_bookings` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `executive_id` INT UNSIGNED NOT NULL,
  `destination` VARCHAR(150) NOT NULL,
  `itinerary_details` TEXT, -- Flight details JSON
  `status` ENUM('Draft', 'Submitted', 'Approved', 'Rejected') DEFAULT 'Draft',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`executive_id`) REFERENCES `corporate_users`(`id`) ON DELETE CASCADE,
  KEY `idx_corporate_travel_bookings_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `corporate_expenses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `travel_id` INT UNSIGNED DEFAULT NULL,
  `amount` DECIMAL(15, 2) NOT NULL,
  `currency` VARCHAR(3) DEFAULT 'USD',
  `receipt_s3_key` VARCHAR(512) DEFAULT NULL,
  `status` ENUM('Pending', 'Approved', 'Paid') DEFAULT 'Pending',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`travel_id`) REFERENCES `corporate_travel_bookings`(`id`) ON DELETE SET NULL,
  KEY `idx_corporate_expenses_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Performance Telemetry Metrics
CREATE TABLE IF NOT EXISTS `corporate_performance_logs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id` VARCHAR(50) DEFAULT NULL,
  `task_id` INT UNSIGNED NOT NULL,
  `secretary_id` INT UNSIGNED NOT NULL,
  `response_time_seconds` INT UNSIGNED NOT NULL,
  `completed_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  FOREIGN KEY (`task_id`) REFERENCES `corporate_tasks`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`secretary_id`) REFERENCES `corporate_users`(`id`) ON DELETE CASCADE,
  KEY `idx_corporate_performance_logs_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- MAIN SAFEGUARD: TREASURER FINANCIAL OVERSIGHT MODULE
-- 6 Tables + 1 View + 1 Trigger
-- ============================================================

--
-- 1. safeguard_budgets_accounts
--    Manages budgets, actual accounts, financial statements,
--    and committee presentation approval states.
--
CREATE TABLE IF NOT EXISTS `safeguard_budgets_accounts` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`               VARCHAR(50) DEFAULT NULL,
  `budget_name`            VARCHAR(255) NOT NULL,
  `category`               ENUM('Operating','Capital','Project','Reserve','Contingency') NOT NULL DEFAULT 'Operating',
  `fiscal_year`            YEAR NOT NULL,
  `allocated_budget`       DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `actual_spend`           DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `projected_income`       DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `actual_income`          DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `variance_notes`         TEXT,
  `statement_type`         ENUM('Income_Statement','Balance_Sheet','Cash_Flow','Trial_Balance') DEFAULT 'Income_Statement',
  `committee_approval`     ENUM('Draft','Pending_Review','Approved','Rejected') NOT NULL DEFAULT 'Draft',
  `approved_by`            VARCHAR(150) DEFAULT NULL,
  `approval_date`          DATE DEFAULT NULL,
  `presentation_ready`     TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_safeguard_budgets_accounts_admin` (`admin_id`),
  KEY `idx_sba_category` (`category`),
  KEY `idx_sba_fiscal_year` (`fiscal_year`),
  KEY `idx_sba_approval` (`committee_approval`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- 2. safeguard_compliance_logs
--    Logs staff financial notes, regulatory legislation
--    statuses, and funder conditions checkmarks.
--
CREATE TABLE IF NOT EXISTS `safeguard_compliance_logs` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`               VARCHAR(50) DEFAULT NULL,
  `log_type`               ENUM('Staff_Note','Legislation','Funder_Condition','Audit_Check','System_Control') NOT NULL,
  `staff_member_name`      VARCHAR(150) DEFAULT NULL,
  `staff_email`            VARCHAR(200) DEFAULT NULL,
  `subject`                VARCHAR(255) NOT NULL,
  `details`                TEXT,
  `compliance_status`      ENUM('Compliant','Non_Compliant','Under_Review','Pending','Waived') NOT NULL DEFAULT 'Pending',
  `legislation_ref`        VARCHAR(255) DEFAULT NULL,
  `funder_name`            VARCHAR(200) DEFAULT NULL,
  `condition_met`          TINYINT(1) DEFAULT NULL,
  `severity`               ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
  `resolution_date`        DATE DEFAULT NULL,
  `created_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_safeguard_compliance_logs_admin` (`admin_id`),
  KEY `idx_scl_type` (`log_type`),
  KEY `idx_scl_status` (`compliance_status`),
  KEY `idx_scl_severity` (`severity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- 3. safeguard_funding_sources
--    Tracks grants, fundraising initiatives, sales revenue,
--    and usage constraints.
--
CREATE TABLE IF NOT EXISTS `safeguard_funding_sources` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`               VARCHAR(50) DEFAULT NULL,
  `source_name`            VARCHAR(255) NOT NULL,
  `source_type`            ENUM('Grant','Donation','Fundraising','Sales_Revenue','Membership_Fee','Investment_Return','Other') NOT NULL,
  `funder_body`            VARCHAR(255) DEFAULT NULL,
  `amount_awarded`         DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `amount_received`        DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `amount_spent`           DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `usage_restriction`      TEXT,
  `restriction_compliant`  TINYINT(1) NOT NULL DEFAULT 1,
  `campaign_target`        DECIMAL(18,2) DEFAULT 0.00,
  `campaign_raised`        DECIMAL(18,2) DEFAULT 0.00,
  `start_date`             DATE DEFAULT NULL,
  `end_date`               DATE DEFAULT NULL,
  `status`                 ENUM('Active','Completed','Suspended','Pending_Approval') NOT NULL DEFAULT 'Active',
  `legislative_check`      TINYINT(1) NOT NULL DEFAULT 1,
  `created_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_safeguard_funding_sources_admin` (`admin_id`),
  KEY `idx_sfs_type` (`source_type`),
  KEY `idx_sfs_status` (`status`),
  KEY `idx_sfs_dates` (`start_date`, `end_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- 4. safeguard_financial_forecasts
--    Stores dynamic variables for operational planning,
--    strategic impact evaluations, reserves targets,
--    and investment policies.
--
CREATE TABLE IF NOT EXISTS `safeguard_financial_forecasts` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`               VARCHAR(50) DEFAULT NULL,
  `forecast_name`          VARCHAR(255) NOT NULL,
  `forecast_type`          ENUM('Operational','Strategic','Reserves','Investment','What_If') NOT NULL DEFAULT 'Operational',
  `fiscal_year`            YEAR NOT NULL,
  `quarter`                ENUM('Q1','Q2','Q3','Q4','Full_Year') NOT NULL DEFAULT 'Full_Year',
  `allocated_budget`       DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `actual_spend`           DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `projected_income`       DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `reserves_target`        DECIMAL(18,2) DEFAULT 0.00,
  `current_reserves`       DECIMAL(18,2) DEFAULT 0.00,
  `investment_policy_target` DECIMAL(18,2) DEFAULT 0.00,
  `risk_factor`            ENUM('Low','Medium','High','Critical') NOT NULL DEFAULT 'Medium',
  `scenario_label`         VARCHAR(200) DEFAULT NULL,
  `scenario_assumptions`   TEXT,
  `notes`                  TEXT,
  `created_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_safeguard_financial_forecasts_admin` (`admin_id`),
  KEY `idx_sff_type` (`forecast_type`),
  KEY `idx_sff_year_qtr` (`fiscal_year`, `quarter`),
  KEY `idx_sff_risk` (`risk_factor`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- 5. safeguard_bank_ledgers
--    Manages linked bank accounts, payments, lodgements,
--    petty cash distribution, and transaction accountability.
--
CREATE TABLE IF NOT EXISTS `safeguard_bank_ledgers` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`               VARCHAR(50) DEFAULT NULL,
  `account_name`           VARCHAR(200) NOT NULL,
  `account_number`         VARCHAR(50) DEFAULT NULL,
  `bank_name`              VARCHAR(200) DEFAULT NULL,
  `transaction_type`       ENUM('Payment','Lodgement','Transfer','Petty_Cash_Out','Petty_Cash_In','Bank_Charge','Interest') NOT NULL,
  `transaction_date`       DATE NOT NULL,
  `amount`                 DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `running_balance`        DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `description`            VARCHAR(500) DEFAULT NULL,
  `payee_or_payer`         VARCHAR(200) DEFAULT NULL,
  `handled_by`             VARCHAR(150) NOT NULL,
  `receipt_reference`      VARCHAR(255) DEFAULT NULL,
  `supporting_doc_ref`     VARCHAR(255) DEFAULT NULL,
  `requires_audit_review`  TINYINT(1) NOT NULL DEFAULT 0,
  `audit_flag_reason`      VARCHAR(500) DEFAULT NULL,
  `reconciled`             TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_safeguard_bank_ledgers_admin` (`admin_id`),
  KEY `idx_sbl_account` (`account_name`),
  KEY `idx_sbl_type` (`transaction_type`),
  KEY `idx_sbl_date` (`transaction_date`),
  KEY `idx_sbl_audit` (`requires_audit_review`),
  KEY `idx_sbl_handler` (`handled_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- 6. safeguard_fixed_assets_insurance
--    Tracks asset logs, stock numbers, valuations,
--    depreciation scales, and active insurance policies.
--
CREATE TABLE IF NOT EXISTS `safeguard_fixed_assets_insurance` (
  `id`                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`               VARCHAR(50) DEFAULT NULL,
  `asset_name`             VARCHAR(255) NOT NULL,
  `asset_category`         ENUM('Land','Building','Vehicle','Equipment','Furniture','IT_Hardware','IT_Software','Stock','Other') NOT NULL,
  `asset_tag`              VARCHAR(100) DEFAULT NULL,
  `purchase_date`          DATE DEFAULT NULL,
  `purchase_cost`          DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `current_valuation`      DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `depreciation_rate`      DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  `accumulated_depreciation` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  `net_book_value`         DECIMAL(18,2) GENERATED ALWAYS AS (`purchase_cost` - `accumulated_depreciation`) STORED,
  `stock_quantity`         INT UNSIGNED DEFAULT 0,
  `location`               VARCHAR(200) DEFAULT NULL,
  `condition_status`       ENUM('Excellent','Good','Fair','Poor','Disposed') NOT NULL DEFAULT 'Good',
  `insurance_provider`     VARCHAR(200) DEFAULT NULL,
  `insurance_policy_no`    VARCHAR(100) DEFAULT NULL,
  `insurance_start_date`   DATE DEFAULT NULL,
  `insurance_expiry_date`  DATE DEFAULT NULL,
  `insurance_premium`      DECIMAL(18,2) DEFAULT 0.00,
  `insurance_status`       ENUM('Active','Expired','Pending_Renewal','Not_Insured') NOT NULL DEFAULT 'Not_Insured',
  `investment_advice_note` TEXT,
  `created_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_safeguard_fixed_assets_insurance_admin` (`admin_id`),
  KEY `idx_sfai_category` (`asset_category`),
  KEY `idx_sfai_condition` (`condition_status`),
  KEY `idx_sfai_ins_status` (`insurance_status`),
  KEY `idx_sfai_ins_expiry` (`insurance_expiry_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

--
-- DYNAMIC REVISED FORECASTS VIEW
-- Automatically computes revised financial forecasts by
-- evaluating actual_spend against initial allocated_budget.
-- Usage: SELECT * FROM v_safeguard_revised_forecasts;
--
CREATE OR REPLACE VIEW `v_safeguard_revised_forecasts` AS
SELECT
  `id`,
  `admin_id`,
  `forecast_name`,
  `forecast_type`,
  `fiscal_year`,
  `quarter`,
  `allocated_budget`,
  `actual_spend`,
  `projected_income`,
  (`allocated_budget` - `actual_spend` + `projected_income`)  AS `revised_forecast`,
  (`allocated_budget` - `actual_spend`)                       AS `variance_amount`,
  CASE
    WHEN `allocated_budget` > 0
      THEN ROUND(((`allocated_budget` - `actual_spend`) / `allocated_budget`) * 100, 2)
    ELSE 0.00
  END                                                         AS `variance_pct`,
  `reserves_target`,
  `current_reserves`,
  CASE
    WHEN `reserves_target` > 0
      THEN ROUND((`current_reserves` / `reserves_target`) * 100, 2)
    ELSE 0.00
  END                                                         AS `reserves_coverage_pct`,
  `investment_policy_target`,
  `risk_factor`,
  `scenario_label`,
  `notes`,
  `created_at`,
  `updated_at`
FROM `safeguard_financial_forecasts`;

--
-- AUTOMATED ACCOUNTABILITY TRIGGER
-- Monitors transaction insertions on safeguard_bank_ledgers.
-- If a user handles money but leaves receipt_reference or
-- supporting_doc_ref empty, auto-flags with
-- requires_audit_review = TRUE and generates reason.
--
DELIMITER $$

CREATE TRIGGER `trg_bank_ledger_audit_flag`
BEFORE INSERT ON `safeguard_bank_ledgers`
FOR EACH ROW
BEGIN
  DECLARE missing_fields VARCHAR(500) DEFAULT '';

  -- Check for money-handling transaction types that require documentation
  IF NEW.transaction_type IN ('Payment','Lodgement','Petty_Cash_Out','Petty_Cash_In','Transfer') THEN

    IF NEW.receipt_reference IS NULL OR TRIM(NEW.receipt_reference) = '' THEN
      SET missing_fields = CONCAT(missing_fields, 'receipt_reference');
    END IF;

    IF NEW.supporting_doc_ref IS NULL OR TRIM(NEW.supporting_doc_ref) = '' THEN
      IF LENGTH(missing_fields) > 0 THEN
        SET missing_fields = CONCAT(missing_fields, ', ');
      END IF;
      SET missing_fields = CONCAT(missing_fields, 'supporting_doc_ref');
    END IF;

    IF LENGTH(missing_fields) > 0 THEN
      SET NEW.requires_audit_review = 1;
      SET NEW.audit_flag_reason = CONCAT(
        'COMPLIANCE ALERT: Transaction by "', NEW.handled_by,
        '" on ', NEW.transaction_date,
        ' (', NEW.transaction_type, ' of ', FORMAT(NEW.amount, 2),
        ') is missing required documentation fields: [', missing_fields,
        ']. Flagged automatically for audit review.'
      );
    END IF;

  END IF;
END$$

DELIMITER ;
