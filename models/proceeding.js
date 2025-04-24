const { DataTypes } = require('sequelize');
const sequelize = require('./index');
const Case = require('./Case');

const Proceeding = sequelize.define('Proceeding', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
  },
  case_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Case,
      key: 'id',
    },
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
    allowNull: true,
  },
});

Case.hasMany(Proceeding, { foreignKey: 'case_id', onDelete: 'CASCADE' });
Proceeding.belongsTo(Case, { foreignKey: 'case_id' });

module.exports = Proceeding;