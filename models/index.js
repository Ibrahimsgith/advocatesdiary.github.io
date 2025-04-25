const Sequelize = require('sequelize');
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: 'cases.db',
  logging: console.log, // Enable logging
});

const User = require('./User')(sequelize);
const Case = require('./Case')(sequelize);
const Proceeding = require('./Proceeding')(sequelize);

Case.hasMany(Proceeding, { foreignKey: 'case_id' });
Proceeding.belongsTo(Case, { foreignKey: 'case_id' });

module.exports = { sequelize, User, Case, Proceeding };