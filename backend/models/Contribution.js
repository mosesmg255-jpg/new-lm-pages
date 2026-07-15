const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'Contribution',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      member_id: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, index: true },
      admin_id: { type: DataTypes.STRING(50), allowNull: true, index: true },
      member_name: { type: DataTypes.STRING(150), allowNull: false, defaultValue: '' },
      amount: { type: DataTypes.DECIMAL(18, 2), allowNull: false },
      payment_method: { type: DataTypes.STRING(100), allowNull: false },
      receipt_url: { type: DataTypes.STRING(255), allowNull: true },
      status: { type: DataTypes.STRING(100), allowNull: false, defaultValue: 'Pending Head Treasurer Reconciliation' },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    {
      tableName: 'contributions',
      timestamps: false
    }
  );
