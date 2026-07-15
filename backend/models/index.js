const sequelize = require('../config/sequelize');

const defineMember = require('./Member');
const defineLoan = require('./Loan');
const defineRepayment = require('./Repayment');
const defineContribution = require('./Contribution');
const defineExpenseClaim = require('./ExpenseClaim');

const Member = defineMember(sequelize);
const Loan = defineLoan(sequelize);
const Repayment = defineRepayment(sequelize);
const Contribution = defineContribution(sequelize);
const ExpenseClaim = defineExpenseClaim(sequelize);

// No FK relations are defined here yet.
// Keeping this empty avoids table-sync failures due to mismatched key types.


module.exports = {
  sequelize,
  Member,
  Loan,
  Repayment,
  Contribution,
  ExpenseClaim
};

