const { DataTypes } = require('sequelize');
module.exports = (sequelize) => {
  const Proceeding = sequelize.define('Proceeding', {
    case_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    proceeding_date: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    tentative_date: {
      type: DataTypes.DATE,
    },
  });
  return Proceeding;
};