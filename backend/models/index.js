const sequelize = require('../config/sequelize');

const defineMember = require('./Member');
const defineLoan = require('./Loan');
const defineRepayment = require('./Repayment');
const defineContribution = require('./Contribution');
const defineExpenseClaim = require('./ExpenseClaim');
const defineMemberSaving = require('./MemberSaving');

const Member = defineMember(sequelize);
const Loan = defineLoan(sequelize);
const Repayment = defineRepayment(sequelize);
const Contribution = defineContribution(sequelize);
const ExpenseClaim = defineExpenseClaim(sequelize);
const MemberSaving = defineMemberSaving(sequelize);

// --- Model Associations ---
// Loan belongs to a member (borrower)
Loan.belongsTo(Member, { foreignKey: 'borrower_id', as: 'borrower' });
Member.hasMany(Loan, { foreignKey: 'borrower_id', as: 'loans' });

// Repayment belongs to a Loan
Repayment.belongsTo(Loan, { foreignKey: 'loan_id', as: 'loan' });
Loan.hasMany(Repayment, { foreignKey: 'loan_id', as: 'repayments' });

// Repayment belongs to a Member
Repayment.belongsTo(Member, { foreignKey: 'member_id', as: 'member' });
Member.hasMany(Repayment, { foreignKey: 'member_id', as: 'repayments' });

// Contribution belongs to a Member
Contribution.belongsTo(Member, { foreignKey: 'member_id', as: 'member' });
Member.hasMany(Contribution, { foreignKey: 'member_id', as: 'contributions' });

// ExpenseClaim belongs to a Member
ExpenseClaim.belongsTo(Member, { foreignKey: 'member_id', as: 'member' });
Member.hasMany(ExpenseClaim, { foreignKey: 'member_id', as: 'expenseClaims' });

// MemberSaving belongs to a Member
MemberSaving.belongsTo(Member, { foreignKey: 'member_id', as: 'member' });
Member.hasMany(MemberSaving, { foreignKey: 'member_id', as: 'savings' });

module.exports = {
  sequelize,
  Member,
  Loan,
  Repayment,
  Contribution,
  ExpenseClaim,
  MemberSaving
};
