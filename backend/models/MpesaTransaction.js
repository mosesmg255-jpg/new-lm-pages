const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const MpesaTransaction = sequelize.define('MpesaTransaction', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    member_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    phone: {
      type: DataTypes.STRING(20),
      allowNull: false
    },
    purpose: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('pending', 'paid_pending_approval', 'approved', 'denied', 'failed'),
      defaultValue: 'pending'
    },
    checkout_request_id: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    merchant_request_id: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    admin_id: {
      type: DataTypes.STRING(50),
      allowNull: true
    }
  }, {
    tableName: 'mpesa_transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at'
  });

  return MpesaTransaction;
};
