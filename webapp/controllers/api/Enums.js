module.exports = function(app) {
  var Enums = require("./../../core/Enums");

  return function(request, response) {
    return response.status(200).json(Enums);
  };
};