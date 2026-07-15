const { DataTypes } = require('sequelize');

module.exports = (sequelize) =>
  sequelize.define(
    'Member',
    {
      // Use integer PK like typical MySQL; map to API DTO with `id`.
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },

      full_name: { type: DataTypes.STRING(100), allowNull: false },
      email: { type: DataTypes.STRING(150), allowNull: false, unique: true, index: true },
      phone: { type: DataTypes.STRING(50), allowNull: false, defaultValue: '' },

      password_hash: { type: DataTypes.STRING(255), allowNull: false },

      status: {
        type: DataTypes.ENUM('pending', 'approved', 'denied'),
        allowNull: false,
        defaultValue: 'pending',
        index: true
      },
      transaction_pin: { type: DataTypes.STRING(255), allowNull: true },
      security_pin: { type: DataTypes.STRING(10), allowNull: true },
      admin_id: { type: DataTypes.STRING(50), allowNull: true, index: true },
      approved: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
    },
    {
      tableName: 'members',
      timestamps: false
    }
  );
