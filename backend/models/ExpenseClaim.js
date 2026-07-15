const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'ExpenseClaim',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      member_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, index: true },
      admin_id: { type: DataTypes.STRING(50), allowNull: true, index: true },
      category: { type: DataTypes.STRING(150), allowNull: false },
      amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
      receipt_url: { type: DataTypes.STRING(255), allowNull: true }, // Optional
      status: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'Pending Authorization' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    {
      tableName: 'expense_claims',
      timestamps: false
    }
  );
