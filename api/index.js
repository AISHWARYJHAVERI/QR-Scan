const app = require('../server/index');

let cachedApp = null;

module.exports = async (req, res) => {
  if (!cachedApp) {
    cachedApp = app;
  }
  return cachedApp(req, res);
};
