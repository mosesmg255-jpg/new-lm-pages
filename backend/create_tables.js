const sequelize = require('./config/sequelize');

const ddlStatements = [
  // 1. Corporate Users & Roles
  `CREATE TABLE IF NOT EXISTS \`corporate_users\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`full_name\` VARCHAR(100) NOT NULL,
    \`email\` VARCHAR(150) NOT NULL UNIQUE,
    \`role\` ENUM('Executive', 'Secretary', 'Admin') NOT NULL,
    \`status\` ENUM('Available', 'Busy', 'Away', 'Offline') NOT NULL DEFAULT 'Offline',
    \`skills\` VARCHAR(255) DEFAULT 'general',
    \`current_workload\` INT UNSIGNED DEFAULT 0,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_corp_users_role\` (\`role\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // 2. Tasks & Automatic Routing
  `CREATE TABLE IF NOT EXISTS \`corporate_tasks\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`title\` VARCHAR(255) NOT NULL,
    \`description\` TEXT,
    \`priority\` ENUM('Low', 'Medium', 'High', 'Critical') DEFAULT 'Medium',
    \`status\` ENUM('Unassigned', 'Assigned', 'In_Progress', 'Completed', 'Escalated') DEFAULT 'Unassigned',
    \`creator_id\` INT UNSIGNED NOT NULL,
    \`assignee_id\` INT UNSIGNED DEFAULT NULL,
    \`idempotency_key\` VARCHAR(100) UNIQUE NOT NULL,
    \`sla_deadline\` DATETIME NOT NULL,
    \`version\` INT UNSIGNED DEFAULT 1,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    FOREIGN KEY (\`creator_id\`) REFERENCES \`corporate_users\`(\`id\`) ON DELETE CASCADE,
    FOREIGN KEY (\`assignee_id\`) REFERENCES \`corporate_users\`(\`id\`) ON DELETE SET NULL,
    KEY \`idx_corp_tasks_status\` (\`status\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // 3. Room Bookings
  `CREATE TABLE IF NOT EXISTS \`corporate_rooms\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`name\` VARCHAR(100) NOT NULL,
    \`capacity\` INT UNSIGNED NOT NULL,
    \`location\` VARCHAR(150) DEFAULT '',
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`corporate_bookings\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`room_id\` INT UNSIGNED NOT NULL,
    \`title\` VARCHAR(255) NOT NULL,
    \`organizer_id\` INT UNSIGNED NOT NULL,
    \`start_time\` DATETIME NOT NULL,
    \`end_time\` DATETIME NOT NULL,
    \`timezone\` VARCHAR(100) DEFAULT 'UTC',
    \`version\` INT UNSIGNED DEFAULT 1,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    FOREIGN KEY (\`room_id\`) REFERENCES \`corporate_rooms\`(\`id\`) ON DELETE CASCADE,
    FOREIGN KEY (\`organizer_id\`) REFERENCES \`corporate_users\`(\`id\`) ON DELETE CASCADE,
    INDEX \`idx_corp_booking_overlap\` (\`room_id\`, \`start_time\`, \`end_time\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // 4. Document Control
  `CREATE TABLE IF NOT EXISTS \`corporate_documents\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`filename\` VARCHAR(255) NOT NULL,
    \`s3_bucket\` VARCHAR(100) NOT NULL,
    \`s3_key\` VARCHAR(512) NOT NULL,
    \`version\` INT UNSIGNED NOT NULL DEFAULT 1,
    \`is_locked\` TINYINT(1) DEFAULT 0,
    \`locked_by_id\` INT UNSIGNED DEFAULT NULL,
    \`hash_checksum\` VARCHAR(64) NOT NULL,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    FOREIGN KEY (\`locked_by_id\`) REFERENCES \`corporate_users\`(\`id\`) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`corporate_signatures\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`document_id\` INT UNSIGNED NOT NULL,
    \`signer_id\` INT UNSIGNED NOT NULL,
    \`signature_payload\` TEXT NOT NULL,
    \`signed_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    FOREIGN KEY (\`document_id\`) REFERENCES \`corporate_documents\`(\`id\`) ON DELETE CASCADE,
    FOREIGN KEY (\`signer_id\`) REFERENCES \`corporate_users\`(\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // 5. Consolidated Communication Feed
  `CREATE TABLE IF NOT EXISTS \`corporate_communications\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`source\` ENUM('Email', 'Phone', 'Visitor', 'Chat') NOT NULL,
    \`sender\` VARCHAR(150) NOT NULL,
    \`subject\` VARCHAR(255) DEFAULT NULL,
    \`content\` TEXT,
    \`is_resolved\` TINYINT(1) DEFAULT 0,
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_corp_comm_src\` (\`source\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // 6. Travel & Expenses
  `CREATE TABLE IF NOT EXISTS \`corporate_travel_bookings\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`executive_id\` INT UNSIGNED NOT NULL,
    \`destination\` VARCHAR(150) NOT NULL,
    \`itinerary_details\` TEXT,
    \`status\` ENUM('Draft', 'Submitted', 'Approved', 'Rejected') DEFAULT 'Draft',
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    FOREIGN KEY (\`executive_id\`) REFERENCES \`corporate_users\`(\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  `CREATE TABLE IF NOT EXISTS \`corporate_expenses\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`travel_id\` INT UNSIGNED DEFAULT NULL,
    \`amount\` DECIMAL(15, 2) NOT NULL,
    \`currency\` VARCHAR(3) DEFAULT 'USD',
    \`receipt_s3_key\` VARCHAR(512) DEFAULT NULL,
    \`status\` ENUM('Pending', 'Approved', 'Paid') DEFAULT 'Pending',
    \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    FOREIGN KEY (\`travel_id\`) REFERENCES \`corporate_travel_bookings\`(\`id\`) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // 7. Performance Telemetry
  `CREATE TABLE IF NOT EXISTS \`corporate_performance_logs\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`task_id\` INT UNSIGNED NOT NULL,
    \`secretary_id\` INT UNSIGNED NOT NULL,
    \`response_time_seconds\` INT UNSIGNED NOT NULL,
    \`completed_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    FOREIGN KEY (\`task_id\`) REFERENCES \`corporate_tasks\`(\`id\`) ON DELETE CASCADE,
    FOREIGN KEY (\`secretary_id\`) REFERENCES \`corporate_users\`(\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // 8. Deleted Members Recovery
  `CREATE TABLE IF NOT EXISTS \`deleted_members\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`original_id\` INT UNSIGNED NOT NULL,
    \`full_name\` VARCHAR(100) NOT NULL,
    \`email\` VARCHAR(150) NOT NULL,
    \`phone\` VARCHAR(50) NOT NULL DEFAULT '',
    \`password\` VARCHAR(255) NOT NULL,
    \`transaction_pin\` VARCHAR(255) NULL,
    \`security_pin\` VARCHAR(10) NULL,
    \`loanAmount\` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    \`savingsAmount\` DECIMAL(18,2) NOT NULL DEFAULT 0.00,
    \`deleted_by\` VARCHAR(100) NOT NULL DEFAULT 'admin',
    \`deleted_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    KEY \`idx_deleted_members_original\` (\`original_id\`),
    KEY \`idx_deleted_members_email\` (\`email\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

  // 9. Meeting Minutes Registry
  `CREATE TABLE IF NOT EXISTS \`meeting_minutes\` (
    \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
    \`title\` VARCHAR(255) NOT NULL,
    \`meeting_date\` DATE NOT NULL,
    \`attendees\` TEXT NOT NULL,
    \`notes\` TEXT NOT NULL,
    \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
];

async function run() {
  console.log('Connecting to MySQL database...');
  try {
    await sequelize.authenticate();
    console.log('Successfully connected to database.');

    // Disable foreign key checks temporarily so tables can be created in any order
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0;');
    console.log('Disabled foreign key checks.');

    for (let statement of ddlStatements) {
      const tableNameMatch = statement.match(/CREATE TABLE IF NOT EXISTS `(\w+)`/);
      const tableName = tableNameMatch ? tableNameMatch[1] : 'unknown';
      console.log(`Creating table: ${tableName}...`);
      await sequelize.query(statement);
    }

    // Repair approved_members table columns if missing
    try {
      console.log('Verifying approved_members columns...');
      await sequelize.query('ALTER TABLE approved_members ADD COLUMN loanAmount DECIMAL(18,2) NOT NULL DEFAULT 0.00;');
      console.log('Added loanAmount column to approved_members.');
    } catch (err) {
      console.log('loanAmount column check: already exists or skipped.');
    }
    try {
      await sequelize.query('ALTER TABLE approved_members ADD COLUMN savingsAmount DECIMAL(18,2) NOT NULL DEFAULT 0.00;');
      console.log('Added savingsAmount column to approved_members.');
    } catch (err) {
      console.log('savingsAmount column check: already exists or skipped.');
    }
    try {
      await sequelize.query('ALTER TABLE approved_members ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL;');
      console.log('Added admin_id column to approved_members.');
    } catch (err) {
      console.log('admin_id column check: already exists or skipped.');
    }
    try {
      await sequelize.query('ALTER TABLE approved_members ADD COLUMN admin_phone VARCHAR(50) DEFAULT NULL;');
      console.log('Added admin_phone column to approved_members.');
    } catch (err) {
      console.log('admin_phone column check: already exists or skipped.');
    }
    try {
      await sequelize.query('ALTER TABLE approved_members ADD COLUMN transaction_pin VARCHAR(255) NULL;');
      console.log('Added transaction_pin column to approved_members.');
    } catch (err) {
      console.log('transaction_pin column check: already exists or skipped.');
    }
    try {
      await sequelize.query('ALTER TABLE approved_members ADD COLUMN security_pin VARCHAR(10) NULL;');
      console.log('Added security_pin column to approved_members.');
    } catch (err) {
      console.log('security_pin column check: already exists or skipped.');
    }
    try {
      await sequelize.query('ALTER TABLE approved_members ADD COLUMN admin_email VARCHAR(150) DEFAULT NULL;');
      console.log('Added admin_email column to approved_members.');
    } catch (err) {
      console.log('admin_email column check: already exists or skipped.');
    }
    try {
      await sequelize.query('ALTER TABLE approved_members ADD COLUMN admin_name VARCHAR(100) DEFAULT NULL;');
      console.log('Added admin_name column to approved_members.');
    } catch (err) {
      console.log('admin_name column check: already exists or skipped.');
    }

    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1;');
    console.log('Re-enabled foreign key checks.');

    console.log(' All Corporate Portal tables have been successfully created!');
    process.exit(0);
  } catch (err) {
    console.error(' Database migration error:', err.message);
    process.exit(1);
  }
}

run();
