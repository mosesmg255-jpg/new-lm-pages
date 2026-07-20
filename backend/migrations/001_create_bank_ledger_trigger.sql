-- Migration: Create bank ledger audit trigger
-- This requires DELIMITER handling that cannot be done via mysql2 multi-statement

CREATE TRIGGER IF NOT EXISTS `trg_bank_ledger_audit_flag`
BEFORE INSERT ON `safeguard_bank_ledgers`
FOR EACH ROW
BEGIN
  DECLARE missing_fields VARCHAR(500) DEFAULT '';

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
END
