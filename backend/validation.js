const { body, param, query, validationResult } = require('express-validator');

/**
 * Centralized input validation middleware.
 * Returns 400 with validation errors if any checks fail.
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      status: 'fail',
      message: 'Validation failed',
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
}

// Auth validations
const registerRules = [
  body('full_name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('phone').optional().trim().isLength({ max: 50 }),
  body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be 6-128 characters'),
  validate
];

const loginRules = [
  body('identifier').trim().notEmpty().withMessage('Email or name required'),
  body('password').trim().notEmpty().withMessage('Password required'),
  validate
];

// Member validations
const memberCreateRules = [
  body('full_name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('phone').optional().trim().isLength({ max: 50 }),
  body('password').isLength({ min: 6, max: 128 }).withMessage('Password must be 6-128 characters'),
  body('transaction_pin').optional().isLength({ min: 4, max: 6 }).withMessage('PIN must be 4-6 digits'),
  body('security_pin').optional().isLength({ min: 4, max: 10 }).withMessage('Security PIN must be 4-10 characters'),
  validate
];

// Loan validations
const loanCreateRules = [
  body('member_id').isInt({ min: 1 }).withMessage('Valid member ID required'),
  body('amount').isFloat({ min: 50 }).withMessage('Amount must be at least 50 Ksh'),
  body('duration').optional().isInt({ min: 0 }),
  body('interest_rate').optional().isFloat({ min: 0, max: 100 }),
  body('pin').optional().isLength({ min: 1, max: 60 }),
  validate
];

// Repayment validations
const repaymentCreateRules = [
  body('loan_id').isInt({ min: 1 }).withMessage('Valid loan ID required'),
  body('member_id').isInt({ min: 1 }).withMessage('Valid member ID required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be positive'),
  body('payment_method').optional().trim().isLength({ max: 100 }),
  validate
];

// Contribution validations
const contributionCreateRules = [
  body('member_id').isInt({ min: 1 }).withMessage('Valid member ID required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be positive'),
  body('payment_method').optional().trim().isLength({ max: 100 }),
  validate
];

// Expense claim validations
const expenseCreateRules = [
  body('member_id').isInt({ min: 1 }).withMessage('Valid member ID required'),
  body('category').trim().isLength({ min: 1, max: 150 }).withMessage('Category required'),
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be positive'),
  validate
];

// ID param validation
const idParamRules = [
  param('id').isInt({ min: 1 }).withMessage('Valid ID required'),
  validate
];

// Pagination query validation
const paginationRules = [
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 500 }),
  validate
];

module.exports = {
  validate,
  registerRules,
  loginRules,
  memberCreateRules,
  loanCreateRules,
  repaymentCreateRules,
  contributionCreateRules,
  expenseCreateRules,
  idParamRules,
  paginationRules
};
