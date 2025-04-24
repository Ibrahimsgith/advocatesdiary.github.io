const { DataTypes } = require('sequelize');
const sequelize = require('./index');

const Case = sequelize.define('Case', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  client_name: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  case_status: {
    type: DataTypes.TEXT,
    allowNull: false,
  },
  date_created: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
  },
  case_file: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
  interim_orders_file: {
    type: DataTypes.STRING(200),
    allowNull: true,
  },
});

module.exports = Case;