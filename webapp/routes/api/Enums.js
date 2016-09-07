module.exports = function(app) {
  var controller = app.controllers.api.Enums;

  app.get("/api/Enums", controller);
};