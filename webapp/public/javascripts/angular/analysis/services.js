'use strict';

angular.module("terrama2.analysis.services", [
    "terrama2",
    "terrama2.services",
    "terrama2.storager.services",
    "terrama2.dataprovider.services"
  ])
  .service("AnalysisService", AnalysisService)

/**
 * It represents an Analysis service structure, handing save and update mode
 * 
 * @class AnalysisService 
 * @param {Object} $rootScope - An angular rootscope
 * @param {Object} $log - An angular logger.
 * @param {Object} $q - An angular q promise.  
 * @param {Object} i18n - an internationalization module
 * @param {Object} EnumService - A TerraMA² enum service
 * @param {Object} Socket - A TerraMA² socket
 * @param {StoragerService} StoragerService - A TerraMA² Storager Service
 * @param {DataProviderService} DataProviderService - A TerraMA² Data Provider Service
 */
function AnalysisService($rootScope, $log, $q, i18n, EnumService, Socket, StoragerService, DataProviderService) {
  /**
   * @type {AnalysisService}
   */
  var self = this;
  /**
   * It handles TerraMA² internationalization
   */
  this.i18n = i18n;

  /**
   * It handles Storage Service data
   */
  this.storagerService = StoragerService;

  /**
   * It handles Data Provider service data
   */
  this.dataProviderService = DataProviderService;

  /**
   * It defines a TerraMA² enums
   * 
   * @type {Object}
   */
  this.enums = {};

  /**
   * It defines a cached Data Series Semantics
   * 
   * @type {Array<Object>} 
   */
  this.dataSeriesSemanticsList = [];

  /** 
   * Flag for handling update mode
   * @type {boolean}
   */
  this.isUpdating = false;

  /**
   * It defines a TerraMA² Analysis structure
   * 
   * @type {Object}
   */
  this.analysis = { grid: { } };

  /**
   * It defines storager configs
   * 
   * @type {Object}
   */
  this.storager = {};

  /**
   * It defines an analysis metadata. It is used to build analysis data series on save state
   * 
   * @type {Array<Object>}
   */
  this.metadata = [];

  /**
   * It defines a target data series. It is used in: Monitored Object and DCP
   * 
   * @type {Object}
   */
  this.targetDataSeries = null;
  
  /**
   * It defines a list of selected data series in additional data
   * 
   * @type {Array<Object>}
   */
  this.selectedDataSeriesList = [];

  /**
   * It defines a list of data series to display in target data series available
   * 
   * @type {Array<Object>}
   */
  this.filteredDataSeries = [];

  /**
   * It defines a groups of data series in order to select an additional data
   * 
   * @type {Array<Object>}
   */
  this.dataSeriesGroups = [
    { name: "Static", children: [] },
    { name: "Dynamic", children: [] }
  ];

  /**
   * It defines a helper object to handle data series groups iteration
   * 
   * @type {Object}
   */
  this.buffers = {
    "static": [],
    "dynamic": []
  };

  /**
   * It defines available service instances
   * 
   * @type {Array<Object>}
   */
  this.instances = [];

  /**
   * It defines cached data series. Whatever data series in interface is derived from this cache.
   * 
   * @type {Array<Object>}
   */
  this.dataSeriesList = [];

  // methods
  /**
   * It initializes Analysis Services. It tries to fill a members (analysis,storager) and handles a save/update mode
   * 
   * @param {Object} configuration - A javascript object with initializer values
   * @returns {void}
   */
  this.initialize = function(configuration) {
    var analysisInstance = configuration.analysis;

    self.analysis.name = analysisInstance.name;
    self.analysis.description = analysisInstance.description;
    self.analysis.data_provider_id = analysisInstance.dataSeries.data_provider_id;

    // it will trigger watchTypeId
    self.analysis.type_id = analysisInstance.type.id.toString();

    

    self.analysis.instance_id = analysisInstance.service_instance_id.toString();
    self.analysis.script = analysisInstance.script;

    // notify scope to update schedule
    $rootScope.$broadcast("updateSchedule", analysisInstance.schedule);

    analysisInstance.analysis_dataseries_list.forEach(function(analysisDs) {
      var ds = analysisDs.dataSeries;

      if (analysisDs.type === self.enums.AnalysisDataSeriesType.ADDITIONAL_DATA_TYPE) {
        self.selectedDataSeriesList.push(ds);
      } else {
        self.filteredDataSeries.some(function(filteredDs) {
          if (filteredDs.id === ds.id) {
            self.targetDataSeries = filteredDs;
            self.onTargetDataSeriesChange();

            // set identifier
            self.identifier = analysisDs.metadata.identifier;
            return true;
          }
        });
      }

      self.metadata[ds.name] = Object.assign({id: analysisDs.id, alias: analysisDs.alias}, analysisDs.metadata);
    });

    // setting storager format
    self.storagerService.storagerFormats.some(function(storagerFmt) {
      if (analysisInstance.dataSeries.data_series_semantics.id === storagerFmt.id) {
        self.storagerService.storager.format = storagerFmt;

        // trigger on change
        self.storagerService.onStoragerFormatChange();
        return true;
      }
    });
  };

  /**
   * It prepares all analysis watchers
   * 
   * @returns {string}
   */
  this.prepareWatchers = function() {
    $rootScope.$watch(function() {
      return self.analysis.type_id;
    }, function(value) {
      return self.watchTypeId(value);
    });
  }

  /**
   * It sets storager format to the memory
   * 
   * @param {Array<Object>}
   * @returns {void} 
   */
  this.setStoragerFormats = function(formats) {
    self.storagerService.setStoragerFormats(formats);
  };

  /**
   * It sets service instances to the memory
   * 
   * @param {Array<Object>}
   * @returns {void}
   */
  this.setInstances = function(services) {
    self.instances = services;
  };

  /**
   * It sets enums to the memory
   * 
   * @param {Array<Object>}
   * @returns {void}
   */
  this.setEnums = function(enums) {
    self.enums = enums;
  };

  /**
   * It sets a Data Series Semantics to the memory
   * 
   * @param {Array<Object>}
   * @returns {void}
   */
  this.setDataSeriesSemantics = function(dataSeriesSemantics) {
    self.dataSeriesSemanticsList = dataSeriesSemantics;
  };

  /**
   * It sets data series to the memory
   */
  this.setDataSeries = function(dataSeries) {
    self.dataSeriesList = dataSeries;
  };

  /**
   * It detects when area of interest changed. It resets grid interest area to initial state
   * 
   * @returns {void}
   */
  this.onAreaOfInterestChange = function() {
    // resetting area of interest values
    self.analysis.grid.area_of_interest_bounded = {};
    self.analysis.grid.area_of_interest_data_series_id = null;
  }

  /**
   * It performs a additional data series list buffers (static/dynamic) fill.
   * 
   * @access private
   * @returns {void}
   */
  this.$processBuffers = function() {
    // clean old data
    self.buffers = {
      "dynamic": [],
      "static": []
    };

    // cleaning already selected data series
    self.selectedDataSeriesList = [];

    if (parseInt(self.analysis.type_id) === self.enums.AnalysisType.GRID) {
      self.dataSeriesList.forEach(function(dSeries) {
        var semantics = dSeries.data_series_semantics;

        if (semantics.data_series_type_name === self.enums.DataSeriesType.GRID) {
          dSeries.isDynamic = true;
          self.buffers.dynamic.push(dSeries);
        }
      });
    } else {
      self.dataSeriesList.forEach(function(dSeries) {
        var semantics = dSeries.data_series_semantics;

        if (semantics.data_series_type_name === "STATIC_DATA") {
          // skip target data series in additional data
          if (self.targetDataSeries && self.targetDataSeries.id !== dSeries.id) {
            dSeries.isDynamic = false;
            self.buffers.static.push(dSeries);
          }
        } else {
          dSeries.isDynamic = true;
          self.buffers.dynamic.push(dSeries);
        }
      });
    }

    self.dataSeriesGroups[0].children = self.buffers.static;
    self.dataSeriesGroups[1].children = self.buffers.dynamic;
  };

  // listen when a format changed
  $rootScope.$on('storagerFormatChange', function(event, args) {
    self.formatSelected = args.format;

    self.dataSeriesSemanticsList.some(function(data) {
      if (data.code === args.format.code) {
        var metadata = data.metadata;
        var properties = metadata.schema.properties;

        if (self.isUpdating) {
          self.storagerService.modelStorager = self.analysis.dataSeries.dataSets[0].format;
        } else {
          self.storagerService.modelStorager = {};
        }

        self.storagerService.formStorager = metadata.form;
        self.storagerService.schemaStorager = {
          type: 'object',
          properties: metadata.schema.properties,
          required: metadata.schema.required
        };

        // resetting filtered data providers
        self.dataProviderService.filterDataProviderWithSemantics(data);

        $rootScope.$broadcast('schemaFormRedraw');
        return true;
      }
    });
  });

  /**
   * It handles on target data series changed (monitored object and dcp type).
   * 
   * @returns {void}
   */
  this.onTargetDataSeriesChange = function() {
    if (self.targetDataSeries && self.targetDataSeries.name) {
      self.metadata[self.targetDataSeries.name] = {
        alias: self.targetDataSeries.name
      };
    }
  };

  /**
   * It handles a analysis type id value. It will be triggered when analysis type id changed (by main controller)
   * 
   * @param {any} value - An analysis type id
   * @returns {void}
   */
  this.watchTypeId = function(value) {
    self.analysis.metadata = {};
    var semanticsType;
    var intTypeId = parseInt(value);

    if (self.analysis.grid) {
      delete self.analysis.grid;
    }

    if (isNaN(intTypeId)) {
      return;
    }

    self.dataSeriesBoxName = i18n.__("Additional Data");
    switch(intTypeId) {
      case self.enums.AnalysisType.DCP:
        semanticsType = self.enums.DataSeriesType.DCP;
        self.semanticsSelected = "Dcp";
        break;
      case self.enums.AnalysisType.GRID:
        semanticsType = self.enums.DataSeriesType.GRID;
        self.semanticsSelected = "Grid";
        self.dataSeriesBoxName = i18n.__("Grid Data Series");
        break;
      case self.enums.AnalysisType.MONITORED:
        semanticsType = self.enums.DataSeriesType.ANALYSIS_MONITORED_OBJECT;
        self.semanticsSelected = i18n.__("Object Monitored");
        break;
      default:
        console.log("invalid analysis type");
        return;
    }

    // re-fill data series
    self.$processBuffers();

    // filtering formats
    self.storagerService.storagerFormats = [];
    self.dataSeriesSemanticsList.forEach(function(dSemantics) {
      if(dSemantics.data_series_type_name === semanticsType) {
        self.storagerService.storagerFormats.push(Object.assign({}, dSemantics));
      }
    });

    // filtering dataseries
    self.filteredDataSeries = [];
    self.dataSeriesList.forEach(function(dataSeries) {
      var semantics = dataSeries.data_series_semantics;
      if (semantics.data_series_type_name === self.enums.DataSeriesType.STATIC_DATA) {
        self.filteredDataSeries.push(dataSeries);
      }
    });

    if (self.isUpdating) {
      $scope.$emit("analysisTypeChanged");
    }
  };
}