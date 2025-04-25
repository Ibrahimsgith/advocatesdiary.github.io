const { DataTypes } = require('sequelize');
module.exports = (sequelize) => {
  const Case = sequelize.define('Case', {
    client_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    case_status: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    case_file: {
      type: DataTypes.STRING,
    },
    interim_orders_file: {
      type: DataTypes.STRING,
    },
    date_created: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  });
  return Case;
};