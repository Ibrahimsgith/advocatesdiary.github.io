const { Sequelize } = require('sequelize');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: 'cases.db',
  logging: false,
});

module.exports = sequelize;