/**
 * ================================================================
 * MAIN SAFEGUARD - Backend API Routes (MySQL / Sequelize raw queries)
 * Provides CRUD endpoints for all 6 safeguard modules.
 * ================================================================
 */
const express = require('express');
const router = express.Router();
const { sequelize } = require('../models');
const { requireAdmin, getFallbackAdminId } = require('../adminContext');

const SAFEGUARD_TABLES = [
  'safeguard_budgets_accounts',
  'safeguard_compliance_logs',
  'safeguard_funding_sources',
  'safeguard_financial_forecasts',
  'safeguard_bank_ledgers',
  'safeguard_fixed_assets_insurance'
];

(async () => {
  try {
    for (const table of SAFEGUARD_TABLES) {
      try { await sequelize.query(`ALTER TABLE ${table} ADD COLUMN admin_id VARCHAR(50) DEFAULT NULL`); } catch (_) {}
      try { await sequelize.query(`ALTER TABLE ${table} ADD INDEX idx_${table}_admin (admin_id)`); } catch (_) {}
    }
    const fallbackAdminId = await getFallbackAdminId(sequelize);
    if (fallbackAdminId) {
      for (const table of SAFEGUARD_TABLES) {
        await sequelize.query(
          `UPDATE ${table} SET admin_id = :adminId WHERE admin_id IS NULL OR admin_id = ''`,
          { replacements: { adminId: fallbackAdminId } }
        ).catch(() => {});
      }
    }
  } catch (e) {
    console.error('[safeguard init]', e.message || e);
  }
})();

router.use((req, res, next) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  req.admin = admin;
  next();
});

//  Helper: run raw query 
async function query(sql, replacements = []) {
  const [rows] = await sequelize.query(sql, { replacements });
  return rows;
}

// 
// 1. BUDGETS & ACCOUNTS
// 
router.get('/budgets', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM safeguard_budgets_accounts WHERE admin_id=? ORDER BY fiscal_year DESC, created_at DESC', [req.admin.id]);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/budgets', async (req, res) => {
  try {
    const { budget_name, category, fiscal_year, allocated_budget, actual_spend,
            projected_income, actual_income, variance_notes, statement_type,
            committee_approval, approved_by, approval_date, presentation_ready } = req.body;
    await query(
      `INSERT INTO safeguard_budgets_accounts
       (budget_name, category, fiscal_year, allocated_budget, actual_spend,
        projected_income, actual_income, variance_notes, statement_type,
        committee_approval, approved_by, approval_date, presentation_ready, admin_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [budget_name, category || 'Operating', fiscal_year || new Date().getFullYear(),
       allocated_budget || 0, actual_spend || 0, projected_income || 0, actual_income || 0,
       variance_notes || null, statement_type || 'Income_Statement',
       committee_approval || 'Draft', approved_by || null, approval_date || null,
       presentation_ready ? 1 : 0, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.put('/budgets/:id', async (req, res) => {
  try {
    const { budget_name, category, fiscal_year, allocated_budget, actual_spend,
            projected_income, actual_income, variance_notes, statement_type,
            committee_approval, approved_by, approval_date, presentation_ready } = req.body;
    await query(
      `UPDATE safeguard_budgets_accounts SET
         budget_name=?, category=?, fiscal_year=?, allocated_budget=?, actual_spend=?,
         projected_income=?, actual_income=?, variance_notes=?, statement_type=?,
         committee_approval=?, approved_by=?, approval_date=?, presentation_ready=?
       WHERE id=? AND admin_id=?`,
      [budget_name, category, fiscal_year, allocated_budget, actual_spend,
       projected_income, actual_income, variance_notes, statement_type,
       committee_approval, approved_by, approval_date, presentation_ready ? 1 : 0,
       req.params.id, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.delete('/budgets/:id', async (req, res) => {
  try {
    await query('DELETE FROM safeguard_budgets_accounts WHERE id=? AND admin_id=?', [req.params.id, req.admin.id]);
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 
// 2. COMPLIANCE LOGS
// 
router.get('/compliance', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM safeguard_compliance_logs WHERE admin_id=? ORDER BY created_at DESC', [req.admin.id]);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/compliance', async (req, res) => {
  try {
    const { log_type, staff_member_name, staff_email, subject, details,
            compliance_status, legislation_ref, funder_name, condition_met, severity,
            resolution_date } = req.body;
    await query(
      `INSERT INTO safeguard_compliance_logs
       (log_type, staff_member_name, staff_email, subject, details,
        compliance_status, legislation_ref, funder_name, condition_met, severity, resolution_date, admin_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [log_type || 'Staff_Note', staff_member_name || null, staff_email || null,
       subject, details || null, compliance_status || 'Pending',
       legislation_ref || null, funder_name || null,
       condition_met != null ? (condition_met ? 1 : 0) : null,
       severity || 'Medium', resolution_date || null, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 
// 3. FUNDING SOURCES
// 
router.get('/funding', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM safeguard_funding_sources WHERE admin_id=? ORDER BY created_at DESC', [req.admin.id]);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/funding', async (req, res) => {
  try {
    const { source_name, source_type, funder_body, amount_awarded, amount_received,
            amount_spent, usage_restriction, restriction_compliant, campaign_target,
            campaign_raised, start_date, end_date, status, legislative_check } = req.body;
    await query(
      `INSERT INTO safeguard_funding_sources
       (source_name, source_type, funder_body, amount_awarded, amount_received,
        amount_spent, usage_restriction, restriction_compliant, campaign_target,
        campaign_raised, start_date, end_date, status, legislative_check, admin_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [source_name, source_type || 'Grant', funder_body || null,
       amount_awarded || 0, amount_received || 0, amount_spent || 0,
       usage_restriction || null, restriction_compliant != null ? (restriction_compliant ? 1 : 0) : 1,
       campaign_target || 0, campaign_raised || 0, start_date || null, end_date || null,
       status || 'Active', legislative_check != null ? (legislative_check ? 1 : 0) : 1, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.put('/funding/:id', async (req, res) => {
  try {
    const { source_name, source_type, funder_body, amount_awarded, amount_received,
            amount_spent, usage_restriction, restriction_compliant, campaign_target,
            campaign_raised, start_date, end_date, status, legislative_check } = req.body;
    await query(
      `UPDATE safeguard_funding_sources SET
         source_name=?, source_type=?, funder_body=?, amount_awarded=?, amount_received=?,
         amount_spent=?, usage_restriction=?, restriction_compliant=?, campaign_target=?,
         campaign_raised=?, start_date=?, end_date=?, status=?, legislative_check=?
       WHERE id=? AND admin_id=?`,
      [source_name, source_type, funder_body, amount_awarded, amount_received,
       amount_spent, usage_restriction, restriction_compliant ? 1 : 0, campaign_target,
       campaign_raised, start_date, end_date, status, legislative_check ? 1 : 0,
       req.params.id, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 
// 4. FINANCIAL FORECASTS
// 
router.get('/forecasts', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM safeguard_financial_forecasts WHERE admin_id=? ORDER BY fiscal_year DESC, created_at DESC', [req.admin.id]);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/forecasts/revised', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM v_safeguard_revised_forecasts WHERE admin_id=? ORDER BY fiscal_year DESC', [req.admin.id]);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/forecasts', async (req, res) => {
  try {
    const { forecast_name, forecast_type, fiscal_year, quarter,
            allocated_budget, actual_spend, projected_income,
            reserves_target, current_reserves, investment_policy_target,
            risk_factor, scenario_label, scenario_assumptions, notes } = req.body;
    await query(
      `INSERT INTO safeguard_financial_forecasts
       (forecast_name, forecast_type, fiscal_year, quarter,
        allocated_budget, actual_spend, projected_income,
        reserves_target, current_reserves, investment_policy_target,
        risk_factor, scenario_label, scenario_assumptions, notes, admin_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [forecast_name, forecast_type || 'Operational', fiscal_year || new Date().getFullYear(),
       quarter || 'Full_Year', allocated_budget || 0, actual_spend || 0, projected_income || 0,
       reserves_target || 0, current_reserves || 0, investment_policy_target || 0,
       risk_factor || 'Medium', scenario_label || null, scenario_assumptions || null, notes || null, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.put('/forecasts/:id', async (req, res) => {
  try {
    const { forecast_name, forecast_type, fiscal_year, quarter,
            allocated_budget, actual_spend, projected_income,
            reserves_target, current_reserves, investment_policy_target,
            risk_factor, scenario_label, scenario_assumptions, notes } = req.body;
    await query(
      `UPDATE safeguard_financial_forecasts SET
         forecast_name=?, forecast_type=?, fiscal_year=?, quarter=?,
         allocated_budget=?, actual_spend=?, projected_income=?,
         reserves_target=?, current_reserves=?, investment_policy_target=?,
         risk_factor=?, scenario_label=?, scenario_assumptions=?, notes=?
       WHERE id=? AND admin_id=?`,
      [forecast_name, forecast_type, fiscal_year, quarter,
       allocated_budget, actual_spend, projected_income,
       reserves_target, current_reserves, investment_policy_target,
       risk_factor, scenario_label, scenario_assumptions, notes, req.params.id, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 
// 5. BANK LEDGERS
// 
router.get('/bank-ledgers', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM safeguard_bank_ledgers WHERE admin_id=? ORDER BY transaction_date DESC, created_at DESC', [req.admin.id]);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/bank-ledgers', async (req, res) => {
  try {
    const { account_name, account_number, bank_name, transaction_type,
            transaction_date, amount, running_balance, description,
            payee_or_payer, handled_by, receipt_reference, supporting_doc_ref } = req.body;
    await query(
      `INSERT INTO safeguard_bank_ledgers
       (account_name, account_number, bank_name, transaction_type,
        transaction_date, amount, running_balance, description,
        payee_or_payer, handled_by, receipt_reference, supporting_doc_ref, admin_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [account_name, account_number || null, bank_name || null,
       transaction_type || 'Payment', transaction_date || new Date().toISOString().slice(0, 10),
       amount || 0, running_balance || 0, description || null,
       payee_or_payer || null, handled_by || 'System',
       receipt_reference || null, supporting_doc_ref || null, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/bank-ledgers/flagged', async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM safeguard_bank_ledgers WHERE requires_audit_review = 1 AND admin_id=? ORDER BY created_at DESC',
      [req.admin.id]
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 
// 6. FIXED ASSETS & INSURANCE
// 
router.get('/assets', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM safeguard_fixed_assets_insurance WHERE admin_id=? ORDER BY created_at DESC', [req.admin.id]);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.post('/assets', async (req, res) => {
  try {
    const { asset_name, asset_category, asset_tag, purchase_date, purchase_cost,
            current_valuation, depreciation_rate, accumulated_depreciation,
            stock_quantity, location, condition_status,
            insurance_provider, insurance_policy_no, insurance_start_date,
            insurance_expiry_date, insurance_premium, insurance_status,
            investment_advice_note } = req.body;
    await query(
      `INSERT INTO safeguard_fixed_assets_insurance
       (asset_name, asset_category, asset_tag, purchase_date, purchase_cost,
        current_valuation, depreciation_rate, accumulated_depreciation,
        stock_quantity, location, condition_status,
        insurance_provider, insurance_policy_no, insurance_start_date,
        insurance_expiry_date, insurance_premium, insurance_status,
        investment_advice_note, admin_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [asset_name, asset_category || 'Equipment', asset_tag || null,
       purchase_date || null, purchase_cost || 0, current_valuation || 0,
       depreciation_rate || 0, accumulated_depreciation || 0,
       stock_quantity || 0, location || null, condition_status || 'Good',
       insurance_provider || null, insurance_policy_no || null,
       insurance_start_date || null, insurance_expiry_date || null,
       insurance_premium || 0, insurance_status || 'Not_Insured',
       investment_advice_note || null, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.put('/assets/:id', async (req, res) => {
  try {
    const { asset_name, asset_category, asset_tag, purchase_date, purchase_cost,
            current_valuation, depreciation_rate, accumulated_depreciation,
            stock_quantity, location, condition_status,
            insurance_provider, insurance_policy_no, insurance_start_date,
            insurance_expiry_date, insurance_premium, insurance_status,
            investment_advice_note } = req.body;
    await query(
      `UPDATE safeguard_fixed_assets_insurance SET
         asset_name=?, asset_category=?, asset_tag=?, purchase_date=?, purchase_cost=?,
         current_valuation=?, depreciation_rate=?, accumulated_depreciation=?,
         stock_quantity=?, location=?, condition_status=?,
         insurance_provider=?, insurance_policy_no=?, insurance_start_date=?,
         insurance_expiry_date=?, insurance_premium=?, insurance_status=?,
         investment_advice_note=?
       WHERE id=? AND admin_id=?`,
      [asset_name, asset_category, asset_tag, purchase_date, purchase_cost,
       current_valuation, depreciation_rate, accumulated_depreciation,
       stock_quantity, location, condition_status,
       insurance_provider, insurance_policy_no, insurance_start_date,
       insurance_expiry_date, insurance_premium, insurance_status,
       investment_advice_note, req.params.id, req.admin.id]
    );
    res.json({ data: { success: true } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/insurance-alerts', async (req, res) => {
  try {
    const rows = await query(
      `SELECT id, asset_name, asset_category, insurance_provider, insurance_policy_no,
              insurance_start_date, insurance_expiry_date, insurance_premium, insurance_status,
              DATEDIFF(insurance_expiry_date, CURDATE()) AS days_until_expiry
       FROM safeguard_fixed_assets_insurance
       WHERE admin_id=?
         AND insurance_status IN ('Active','Pending_Renewal')
         AND insurance_expiry_date IS NOT NULL
       ORDER BY insurance_expiry_date ASC`,
      [req.admin.id]
    );
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// 
// AGGREGATE STATS (for dashboard summary tiles)
// 
router.get('/stats', async (req, res) => {
  try {
    const [budgetStats] = await query(
      `SELECT COUNT(*) as total_budgets,
              SUM(allocated_budget) as total_allocated,
              SUM(actual_spend) as total_spent,
              SUM(actual_income) as total_income
       FROM safeguard_budgets_accounts WHERE admin_id=?`,
      [req.admin.id]
    );
    const [fundingStats] = await query(
      `SELECT COUNT(*) as total_sources,
              SUM(amount_awarded) as total_awarded,
              SUM(amount_received) as total_received,
              SUM(amount_spent) as total_fund_spent
       FROM safeguard_funding_sources WHERE admin_id=?`,
      [req.admin.id]
    );
    const [ledgerStats] = await query(
      `SELECT COUNT(*) as total_transactions,
              SUM(CASE WHEN requires_audit_review=1 THEN 1 ELSE 0 END) as flagged_count
       FROM safeguard_bank_ledgers WHERE admin_id=?`,
      [req.admin.id]
    );
    const [assetStats] = await query(
      `SELECT COUNT(*) as total_assets,
              SUM(purchase_cost) as total_asset_value,
              SUM(CASE WHEN insurance_status='Expired' OR
                   (insurance_expiry_date IS NOT NULL AND insurance_expiry_date < CURDATE())
                   THEN 1 ELSE 0 END) as expired_insurance_count
       FROM safeguard_fixed_assets_insurance WHERE admin_id=?`,
      [req.admin.id]
    );
    res.json({
      data: {
        budgets: budgetStats || {},
        funding: fundingStats || {},
        ledgers: ledgerStats || {},
        assets: assetStats || {}
      }
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;
