const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'Repayment',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },

      loan_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, index: true },
      member_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, index: true },
      admin_id: { type: DataTypes.STRING(50), allowNull: true, index: true },

      member_name: { type: DataTypes.STRING(150), allowNull: false, defaultValue: '' },

      amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
      payment_method: { type: DataTypes.STRING(100), allowNull: false, defaultValue: '' },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    {
      tableName: 'repayments',
      timestamps: false
    }
  );
