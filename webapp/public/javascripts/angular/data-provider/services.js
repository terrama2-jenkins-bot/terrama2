angular.module("terrama2.dataprovider.services", ["terrama2"])
  .service("DataProviderService", DataProviderService);


function DataProviderService() {
  var self = this;

  /**
   * It defines a list of data providers in memory
   * 
   * @type {Array<Object>}
   */
  this.dataProviderList = [];

  /**
   * It defines a filtered data providers basead in semantics
   * 
   * @type {Array<Object>}
   */
  this.dataProviders = [];

  /**
   * It sets data providers to the memory
   * 
   * @param {Array<Object>} dataProviders - A loaded data providers
   * @returns {void}
   */
  this.setDataProviderList = function(dataProviders) {
    self.dataProviderList = dataProviders;
  };

  /**
   * It performs a data provider filter from semantics
   * 
   * @param {Array<Object>}
   */
  this.filterDataProviderWithSemantics = function(semantics) {
    self.dataProvidersList.forEach(function(dataProvider) {
      semantics.data_providers_semantics.forEach(function(demand) {
        if (parseInt(dataProvider.data_provider_type.id) === parseInt(demand.data_provider_type_id)) {
          self.dataProviders.push(dataProvider);
        }
      });
    });
  }
}