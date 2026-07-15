const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'Loan',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },

      borrower_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, index: true },
      admin_id: { type: DataTypes.STRING(50), allowNull: true, index: true },

      borrower_name: { type: DataTypes.STRING(150), allowNull: false },

      amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
      duration: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      interest_rate: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0 },

      status: {
        type: DataTypes.ENUM('Active', 'Settled', 'Approved', 'Disbursed', 'Overdue', 'Denied'),
        allowNull: false,
        defaultValue: 'Active',
        index: true
      },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    {
      tableName: 'loans',
      timestamps: false
    }
  );
