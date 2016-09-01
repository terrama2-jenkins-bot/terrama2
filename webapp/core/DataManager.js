'use strict';

/**
 * @license
 * Copyright (C) 2007 National Institute For Space Research (INPE) - Brazil.
 *
 * This file is part of TerraMA2 - a free and open source computational
 * platform for analysis, monitoring, and alert of geo-environmental extremes.
 *
 * TerraMA2 is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.

 * TerraMA2 is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Lesser General Public License for more details.

 * You should have received a copy of the GNU Lesser General Public License
 * along with TerraMA2. See LICENSE. If not, write to
 * TerraMA2 Team at <terrama2-team@dpi.inpe.br>.
*/

var modelsFn = require("../models");
var exceptions = require('./Exceptions');
var Promise = require('bluebird');
var Utils = require('./Utils');
var _ = require('lodash');
var Enums = require('./Enums');
var Database = require('../config/Database');
var orm = Database.getORM();
var fs = require('fs');
var path = require('path');
var Filters = require("./filters");

// Tcp
var TcpManager = require('./TcpManager');

// data model
var DataModel = require('./data-model');

// Available DataSeriesType
var DataSeriesType = Enums.DataSeriesType;

// Javascript Lock
var ReadWriteLock = require('rwlock');
var lock = new ReadWriteLock();


function _processFilter(filterObject) {
  var filterValues = Object.assign({}, filterObject);
  // checking filter by date
  if (filterObject.hasOwnProperty('date') && !_.isEmpty(filterObject.date)) {
    if (filterObject.date.beforeDate) {
      filterValues.discard_before = new Date(filterObject.date.beforeDate);
    }
    if (filterObject.date.afterDate) {
      filterValues.discard_after = new Date(filterObject.date.afterDate);
    }
  }

  return filterValues;
}


var models = null;

/**
 * Controller of the system index.
 * @class DataManager
 *
 * @property {object} data - Object for storing model values, such DataProviders, DataSeries and Projects.
 * @property {Boolean} isLoaded - A flag value to determines if DataManager has been loaded before.
 */
var DataManager = {
  data: {
    dataFormats: [],
    dataSeriesTypes: [],
    dataSeriesSemantics: [],

    dataSeries: [],
    dataProviders: [],
    dataSets: [], /** It will store data set id list */
    projects: []
  },
  isLoaded: false,
  orm: orm,

  Promise: Promise,
  TcpManager: TcpManager,
  DataModel: DataModel,

  /**
   * It initializes DataManager, loading models and database synchronization
   * @param {function} callback - A callback function for waiting async operation
   */
  init: function(callback) {
    var self = this;

      var dbConfig = Database.config;

      models = modelsFn();
      models.load(orm);
      self.models = models;

      var fn = function() {
        var inserts = [];

        // default users
        var salt = models.db.User.generateSalt();

        // admin
        inserts.push(models.db.User.create({
          name: "Administrator",
          username: "admin",
          password: models.db.User.generateHash("admin", salt),
          salt: salt,
          cellphone: '14578942362',
          email: 'admin@terrama2.inpe.br',
          administrator: true
        }));

        // services type
        inserts.push(models.db.ServiceType.create({id: 1, name: "COLLECT"}));
        inserts.push(models.db.ServiceType.create({id: 2, name: "ANALYSIS"}));

        // data provider type defaults
        inserts.push(self.addDataProviderType({id: 1, name: "FILE", description: "Desc File"}));
        inserts.push(self.addDataProviderType({id: 2, name: "FTP", description: "Desc Type1"}));
        inserts.push(self.addDataProviderType({id: 3, name: "HTTP", description: "Desc Http"}));
        inserts.push(self.addDataProviderType({id: 4, name: "POSTGIS", description: "Desc Postgis"}));

        // default services
        var collectorService = {
          id: 1,
          name: "Local Collector",
          description: "Local service for Collect",
          port: 6543,
          pathToBinary: "terrama2_service",
          numberOfThreads: 0,
          service_type_id: Enums.ServiceType.COLLECTOR,
          log: {
            host: "127.0.0.1",
            port: 5432,
            user: "postgres",
            password: "postgres",
            database: dbConfig.database
          }
        };

        var analysisService = Object.assign({}, collectorService);
        analysisService.id = 2;
        analysisService.name = "Local Analysis";
        analysisService.description = "Local service for Analysis";
        analysisService.port = 6544;
        analysisService.service_type_id = Enums.ServiceType.ANALYSIS;

        inserts.push(self.addServiceInstance(collectorService));
        inserts.push(self.addServiceInstance(analysisService));

        // data provider intent defaults
        inserts.push(models.db.DataProviderIntent.create({
          id: Enums.DataProviderIntentId.COLLECT,
          name: "COLLECT",
          description: "Desc Collect intent"
        }));

        inserts.push(models.db.DataProviderIntent.create({
          id: Enums.DataProviderIntentId.PROCESSING,
          name: "PROCESSING",
          description: "Desc Processing intent"
        }));

        // data series type defaults
        inserts.push(models.db.DataSeriesType.create({name: DataSeriesType.DCP, description: "Data Series DCP type"}));
        inserts.push(models.db.DataSeriesType.create({name: DataSeriesType.OCCURRENCE, description: "Data Series Occurrence type"}));
        inserts.push(models.db.DataSeriesType.create({name: DataSeriesType.GRID, description: "Data Series Grid type"}));
        inserts.push(models.db.DataSeriesType.create({name: DataSeriesType.ANALYSIS_MONITORED_OBJECT, description: "Data Series Analysis Monitored Object"}));
        inserts.push(models.db.DataSeriesType.create({name: DataSeriesType.STATIC_DATA, description: "Data Series Static Data"}));

        // data formats semantics defaults
        inserts.push(self.addDataFormat({name: Enums.DataSeriesFormat.CSV, description: "CSV description"}));
        inserts.push(self.addDataFormat({name: DataSeriesType.OCCURRENCE, description: "Occurrence description"}));
        inserts.push(self.addDataFormat({name: DataSeriesType.GRID, description: "Grid Description"}));
        inserts.push(self.addDataFormat({name: Enums.DataSeriesFormat.POSTGIS, description: "POSTGIS description"}));
        inserts.push(self.addDataFormat({name: Enums.DataSeriesFormat.OGR, description: "Gdal ogr"}));
        inserts.push(self.addDataFormat({name: Enums.DataSeriesFormat.GEOTIFF, description: "GeoTiff"}));
        inserts.push(self.addDataFormat({name: Enums.DataSeriesFormat.GRADS, description: "GRADS"}));

        // analysis type
        inserts.push(models.db.AnalysisType.create({id: Enums.AnalysisType.DCP, name: "Dcp", description: "Description Dcp"}));
        inserts.push(models.db.AnalysisType.create({id: Enums.AnalysisType.GRID, name: "Grid", description: "Description Grid"}));
        inserts.push(models.db.AnalysisType.create({id: Enums.AnalysisType.MONITORED, name: "Monitored Object", description: "Description Monitored"}));

        // analysis data series type
        inserts.push(models.db.AnalysisDataSeriesType.create({
          id: Enums.AnalysisDataSeriesType.DATASERIES_DCP_TYPE,
          name: "Dcp",
          description: "Description Dcp"
        }));
        inserts.push(models.db.AnalysisDataSeriesType.create({
          id: Enums.AnalysisDataSeriesType.DATASERIES_GRID_TYPE,
          name: "Grid",
          description: "Description Grid"
        }));

        inserts.push(models.db.AnalysisDataSeriesType.create({
          id: Enums.AnalysisDataSeriesType.DATASERIES_MONITORED_OBJECT_TYPE,
          name: "Monitored Object",
          description: "Description Monitored"
        }));

        inserts.push(models.db.AnalysisDataSeriesType.create({
          id: Enums.AnalysisDataSeriesType.ADDITIONAL_DATA_TYPE,
          name: "Additional Data",
          description: "Description Additional Data"
        }));

        // area of interest
        inserts.push(models.db.AnalysisAreaOfInterestType.create({
          id: Enums.InterestAreaType.UNION.value,
          name: Enums.InterestAreaType.UNION.name,
          description: Enums.InterestAreaType.UNION.name
        }));
        inserts.push(models.db.AnalysisAreaOfInterestType.create({
          id: Enums.InterestAreaType.SAME_FROM_DATA_SERIES.value,
          name: Enums.InterestAreaType.SAME_FROM_DATA_SERIES.name,
          description: Enums.InterestAreaType.SAME_FROM_DATA_SERIES.name
        }));
        inserts.push(models.db.AnalysisAreaOfInterestType.create({
          id: Enums.InterestAreaType.CUSTOM.value,
          name: Enums.InterestAreaType.CUSTOM.name,
          description: Enums.InterestAreaType.CUSTOM.name
        }));

        // resolution type
        inserts.push(models.db.AnalysisResolutionType.create({
          id: Enums.ResolutionType.BIGGEST_GRID.value,
          name: Enums.ResolutionType.BIGGEST_GRID.name,
          description: Enums.ResolutionType.BIGGEST_GRID.name
        }));
        inserts.push(models.db.AnalysisResolutionType.create({
          id: Enums.ResolutionType.SMALLEST_GRID.value,
          name: Enums.ResolutionType.SMALLEST_GRID.name,
          description: Enums.ResolutionType.SMALLEST_GRID.name
        }));
        inserts.push(models.db.AnalysisResolutionType.create({
          id: Enums.ResolutionType.SAME_FROM_DATA_SERIES.value,
          name: Enums.ResolutionType.SAME_FROM_DATA_SERIES.name,
          description: Enums.ResolutionType.SAME_FROM_DATA_SERIES.name
        }));
        inserts.push(models.db.AnalysisResolutionType.create({
          id: Enums.ResolutionType.CUSTOM.value,
          name: Enums.ResolutionType.CUSTOM.name,
          description: Enums.ResolutionType.CUSTOM.name
        }));

        // Interpolation methods
        inserts.push(models.db.InterpolationMethod.create({
          id: Enums.InterpolationMethod.NEAREST_NEIGHBOR.value,
          name: Enums.InterpolationMethod.NEAREST_NEIGHBOR.name,
          description: Enums.InterpolationMethod.NEAREST_NEIGHBOR.name
        }));
        inserts.push(models.db.InterpolationMethod.create({
          id: Enums.InterpolationMethod.BI_LINEAR.value,
          name: Enums.InterpolationMethod.BI_LINEAR.name,
          description: Enums.InterpolationMethod.BI_LINEAR.name
        }));
        inserts.push(models.db.InterpolationMethod.create({
          id: Enums.InterpolationMethod.BI_CUBIC.value,
          name: Enums.InterpolationMethod.BI_CUBIC.name,
          description: Enums.InterpolationMethod.BI_CUBIC.name
        }));

        // script language supported
        inserts.push(models.db.ScriptLanguage.create({id: Enums.ScriptLanguage.PYTHON, name: "PYTHON"}));
        inserts.push(models.db.ScriptLanguage.create({id: Enums.ScriptLanguage.LUA, name: "LUA"}));

        // semantics: temp code: TODO: fix
        var semanticsJsonPath = path.join(__dirname, "../../share/terrama2/semantics.json");
        var semanticsObject = JSON.parse(fs.readFileSync(semanticsJsonPath, 'utf-8'));

        // storing semantics providers dependency
        var semanticsWithProviders = {};

        semanticsObject.forEach(function(semanticsElement) {
          semanticsWithProviders[semanticsElement.code] = semanticsElement.providers_type_list;
          inserts.push(self.addDataSeriesSemantics({
            code: semanticsElement.code,
            name: semanticsElement.name,
            data_format_name: semanticsElement.format,
            data_series_type_name: semanticsElement.type,
            collector: semanticsElement.collector || false
          }));
        });

        // it will match each of semantics with providers
        var insertSemanticsProvider = function() {
          self.listSemanticsProvidersType().then(function(result) {
            if (result.length !== 0) {
              callback();
              return;
            }

            self.listDataProviderType().then(function(dataProvidersType) {
              self.listDataSeriesSemantics().then(function(semanticsList) {
                var semanticsProvidersArray = [];
                semanticsList.forEach(function(semantics) {
                  var dependencies = semanticsWithProviders[semantics.code] || [];

                  dependencies.forEach(function(dependency) {
                    dataProvidersType.some(function(providerType) {
                      if (dependency === providerType.name) {
                        semanticsProvidersArray.push({
                          data_provider_type_id: providerType.id,
                          data_series_semantics_id: semantics.id
                        });
                        return true;
                      }
                    });
                  });
                });

                // adding metadata to semantics
                var semanticsMetadataArray = [];
                semanticsList.forEach(function(semantics) {
                  semanticsObject.some(function(element) {
                    if (semantics.code === element.code) {
                      if (element.metadata) {
                        for(var key in element.metadata) {
                          if (element.metadata.hasOwnProperty(key)) {
                            semanticsMetadataArray.push({
                              key: key,
                              value: element.metadata[key],
                              data_series_semantics_id: semantics.id
                            });
                          }
                        }
                      }
                      return true;
                    }
                  });
                });

                var _makeSemanticsMetadata = function() {
                  models.db.SemanticsMetadata.bulkCreate(semanticsMetadataArray).then(function(res) {
                    callback();
                  }).catch(function(err) {
                    callback();
                  });
                };

                models.db.SemanticsProvidersType.bulkCreate(semanticsProvidersArray).then(function(result) {
                  _makeSemanticsMetadata();
                }).catch(function(err) {
                  _makeSemanticsMetadata();
                });
              }).catch(function(err) {
                console.log(err);
                callback();
              });
            }).catch(function(err) {
              console.log(err);
              callback();
            });
          }).catch(function() {
            callback();
          });
        };

        Promise.all(inserts).then(function() {
          insertSemanticsProvider();
        }).catch(function(err) {
          console.log(err);
          insertSemanticsProvider();
        });
      };

      orm.authenticate().then(function() {
        orm.sync().then(function () {
          fn();
        }).catch(function(err) {
          console.log(err);
          fn();
        });
      }).catch(function(err) {
        callback(new Error("Could not initialize TerraMA2 due: " + err.message));
      });
  },

  unload: function() {
    var self = this;
    return new Promise(function(resolve) {
      lock.writeLock(function(release) {
        self.data.dataProviders = [];
        self.data.dataSeries = [];
        self.data.dataSets = [];
        self.data.projects = [];

        self.isLoaded = false;

        resolve();

        release();
      });
    });
  },

  finalize: function() {
    var self = this;
    return new Promise(function(resolve) {
      self.unload().then(function() {
        resolve();

        Database.finalize();
      });
    });
  },

  /**
   * It loads database values in memory
   * @return {Promise} - a 'bluebird' module
   */
  load: function() {
    var self = this;

    return new Promise(function(resolve, reject) {
      if (self.isLoaded) {
        resolve();
        return;
      }

      var clean = function() {
        self.data.dataProviders = [];
        self.data.dataSeries = [];
        self.data.dataSets = [];
        self.data.projects = [];
      };
      // helper for clean up DataManager and reject promise
      var _rejectClean = function(err) {
        clean();
        console.log("CLEAN: ", err);
        reject(err);
      };

      models.db.Project.findAll({}).then(function(projects) {
        projects.forEach(function(project) {
          self.data.projects.push(project.get());
        });

        models.db.DataProvider.findAll({ include: [ models.db.DataProviderType ] }).then(function(dataProviders) {
          dataProviders.forEach(function(dataProvider) {
            self.data.dataProviders.push(new DataModel.DataProvider(dataProvider));
          });
          // find all data series, providers
          models.db.DataSeries.findAll({
            include: [
              {
                model: models.db.DataProvider,
                include: [models.db.DataProviderType]
              },
              models.db.DataSeriesSemantics,
              {
                model: models.db.DataSet,
                include: [
                  {
                    model: models.db.DataSetDcp,
                    attributes: [
                      // retrieving GeoJSON. It is important because Sequelize
                      // orm does not retrieve SRID even geometry has. The "2"
                      // in arguments is to retrieve entire representation.
                      // It retrieves as string. Once GeoJSON retrieved,
                      // you must parse it. "JSON.parse(geoJsonStr)"
                      [orm.fn('ST_AsGeoJSON', orm.col('position'), 0, 2), 'position'],
                      // EWKT representation
                      [orm.fn('ST_AsEwkt', orm.col('position')), 'positionWkt']
                    ],
                    required: false
                  },
                  {
                    model: models.db.DataSetOccurrence,
                    required: false
                  },
                  {
                    model: models.db.DataSetMonitored,
                    required: false
                  },
                  {
                    model: models.db.DataSetGrid,
                    required: false
                  },
                  models.db.DataSetFormat
                ]
              }
            ]
          }).then(function(dataSeries) {
            dataSeries.forEach(function(dSeries) {
              var provider = new DataModel.DataProvider(dSeries.DataProvider.get());

              var builtDataSeries = new DataModel.DataSeries(dSeries.get());
              builtDataSeries.setDataProvider(provider);

              builtDataSeries.dataSets.forEach(function(dSet) {
                self.data.dataSets.push(dSet);
              });

              self.data.dataSeries.push(builtDataSeries);
            });

            self.isLoaded = true;
            resolve();

          }).catch(_rejectClean);
        }).catch(_rejectClean);
      }).catch(_rejectClean);
    });
  },

  /**
   * It retrieves a WKT geometry from a valid GeoJSON
   * @param {Object} geoJSONObject - A GeoJSON object to be converted to WKT format
   * @return {string} WKT representation
   */
  getWKT: function(geoJSONObject) {
    return new Promise(function(resolve, reject) {
      models.db.sequelize.query("SELECT ST_AsEwkt(ST_GeomFromGeoJson('" + JSON.stringify(geoJSONObject) + "')) as geom").then(function(wktGeom) {
        // it retrieves an array with data result (array) and query executed.
        // if data result is empty or greater than 1, its not allowed.
        if (wktGeom[0].length !== 1) { reject(new exceptions.DataSetError("Invalid wkt retrieved from GeoJSON.")); }
        else {
          resolve(wktGeom[0][0].geom);
        }
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  /**
   * It saves Project in database and storage it in memory
   * @param {Object} projectObject - An object containing project values to be saved.
   * @return {Promise} - a 'bluebird' module. The callback is either a {Project} data values or error
   */
  addProject: function(projectObject, options) {
    var self = this;
    return new Promise(function(resolve, reject){
      return models.db.Project.create(projectObject, options).then(function(project){
        self.data.projects.push(project.get());
        return resolve(Utils.clone(project.get()));
      }).catch(function(e) {
        var message = "Could not save project: ";
        if (e.errors) { message += e.errors[0].message; }
        return reject(new exceptions.ProjectError(message));
      });
    });
  },

  /**
   * It retrieves a project from restriction. It should be an object containing either id identifier or name identifier.
   * @param {Object} projectParam - An object containing project identifier. i.e {name: "Project1"}
   * @return {Promise} - a 'bluebird' module. The callback is a clone of project or error
   */
  getProject: function(projectParam) {
    var self = this;
    return new Promise(function(resolve, reject) {
      lock.readLock(function(release) {
        var project = Utils.find(self.data.projects, projectParam);
        if (project) { resolve(Utils.clone(project)); }
        else { reject(new exceptions.ProjectError("Project not found")); }

        release();
      });
    });
  },

  /**
   * It updates a project from given object values.
   *
   * @param {Object} projectObject - an javascript object containing project values
   * @return {Promise<DataFormat>} - a 'bluebird' module with DataFormat instance or error callback
   */
  updateProject: function(projectObject) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.getProject({id: projectObject.id}).then(function(project) {

        models.db.Project.update(projectObject, {
          fields: ["name", "description", "version"],
          where: {
            id: project.id
          }
        }).then(function() {
          var projectItem = Utils.find(self.data.projects, {id: projectObject.id});
          projectItem.name = projectObject.name;
          projectItem.description = projectObject.description;
          projectItem.version = projectObject.version;

          resolve(Utils.clone(projectItem));
        }).catch(function(err) {
          reject(new exceptions.ProjectError("Could update project " + err.toString()));
        });
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  removeProject: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.getProject(restriction).then(function(projectResult) {
        self.listCollectors().then(function(collectors) {
          self.listAnalyses({project_id: projectResult.id}).then(function(analysisList) {
            if (collectors.length === 0 || analysisList.length === 0) {
              return Promise.resolve();
            }

            var scheduleIds = [];
            collectors.forEach(function(collector) {
              if (collector.dataSeriesOutput && collector.dataSeriesOutput.dataProvider.project_id === projectResult.id) {
                scheduleIds.push(collector.schedule.id);
              }
            });

            // pushing analysis schedules into scheduleIds
            Array.prototype.push.apply(scheduleIds, analysisList.map(function(analysis) {
              return analysis.schedule.id;
            }));

            return self.removeSchedule({id: {$in: scheduleIds}})
          }).finally(function() {
            models.db.Project.destroy({
              where: {
                id: projectResult.id
              }
            }).then(function() {
              var project = Utils.remove(self.data.projects, {id: projectResult.id});
              // remove children from memory
              Utils.removeAll(self.data.dataProviders, {project_id: project.id});
              Utils.removeAll(self.data.dataSeries, {dataProvider: {project_id: project.id}});
              return resolve();
            }).catch(function(err) {
              console.log("Remove Project: ", err);
              return reject(new exceptions.ProjectError("Could not remove project with data provider associated"));
            });
          });
        });
      }).catch(function(err) {
        return reject(err);
      });
    });

  },

  /**
   * It retrieves a Project list object from loaded projects.
   *
   * @return {Array} - a 'bluebird' module with Project instance or error callback
   */
  listProjects: function() {
    var projectList = [];
    this.data.projects.forEach(function(project) {
      projectList.push(Utils.clone(project));
    });
    return projectList;
  },

  /**
   * It updates a TerraMA2 user instance
   * @param {Object} restriction - A javascript object to identify a user
   * @param {Object} userObject - A javascript object with user values
   * @return {Promise} a bluebird promise
   */
  updateUser: function(restriction, userObject) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.getUser(restriction).then(function(user) {
        if (!userObject.password) {
          userObject.password = user.password;
        } else {
          var salt = user.salt;
          userObject.password = models.db.User.generateHash(userObject.password, salt);
        }
        models.db.User.update(userObject, {
          fields: ['name', 'cellphone', 'administrator', 'email', 'password'],
          where: restriction || {}
        }).then(function() {
          resolve();
        }).catch(function(err) {
          console.log(err);
          reject(new exceptions.UserError("Could not update user.", err.errors));
        });
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  /**
   * It retrieves all users in database filtering from given restriction
   *
   * @param {Object} restriction - A javascript object with restriction
   * @return {Promise<Array<User>>} a bluebird module with users
   */
  listUsers: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.User.findAll({where: restriction||{}}).then(function(users) {
        resolve(users.map(function(userInstance) { return userInstance.get(); }));
      }).catch(function(err) {
        reject(new exceptions.UserError("Could not update user.", err.errors||[]));
      });
    });
  },

  /**
   * It retrieves a user from given restriction
   *
   * @param {Object} restriction - A javascript object with query restriction
   * @return {Promise<User>} a bluebird module with user sequelize instance
   */
  getUser: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.User.findOne({where: restriction||{}}).then(function(user) {
        if (user === null) {
          return reject(new exceptions.UserError("Could not get user.", []));
        }
        resolve(user);
      }).catch(function(err) {
        reject(new exceptions.UserError("Could not update user.", err.errors||[]));
      });
    });
  },

  /**
   * It saves ServiceInstance in database and storage it in memory
   * @param {Object} serviceObject - An object containing project values to be saved.
   * @return {Promise} - a 'bluebird' module. The callback is either a {ServiceInstance} data values or error
   */
  addServiceInstance: function(serviceObject) {
    return new Promise(function(resolve, reject){
      lock.writeLock(function(release) {
        models.db.ServiceInstance.create(serviceObject).then(function(serviceResult){
          var service = new DataModel.Service(serviceResult);
          var logObject = serviceObject.log;
          logObject.service_instance_id = serviceResult.id;
          models.db.Log.create(logObject).then(function(logResult) {
            var log = new DataModel.Log(logResult);
            service.log = log.toObject();

            resolve(service);
            release();
          }).catch(function(err) {
            console.log(err);
            Utils.rollbackPromises([serviceResult.destroy()], new Error("Could not save log: " + err.message), reject);
            release();
          });

        }).catch(function(e) {
          console.log(e);
          var message = "Could not save service instance: ";
          if (e.errors) { message += e.errors[0].message; }
          reject(new Error(message));
          release();
        });
      });
    });
  },

  /**
   * Retrieves a list of ServiceInstances from restriction
   * @param {Object} restriction - A javascript object with restriction query values.
   * @return {Promise<ServiceInstance>} A promise with Array of Service Instances
   */
  listServiceInstances: function(restriction) {
    return new Promise(function(resolve, reject){
      models.db.ServiceInstance.findAll({
        where: restriction,
        include: [models.db.Log]
      }).then(function(services) {
        var output = [];
        services.forEach(function(service){
          var serviceObject = new DataModel.Service(service.get());
          serviceObject.log = new DataModel.Log(service.Log || {});
          output.push(serviceObject);
        });

        resolve(output);
      }).catch(function(err) {
        console.log(err);
        reject(new Error("Could not retrieve services " + err.message));
      });
    });
  },

  getServiceInstance : function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject){
      self.listServiceInstances(restriction).then(function(result) {
        if (result.length === 0) { return reject(new Error("No service instances found")); }

        if (result.length > 1) { return reject(new Error("More than one service instance retrieved")); }

        resolve(result[0]);
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  removeServiceInstance: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.getServiceInstance(restriction).then(function(serviceResult) {
        // update collectors removing ID and setting them to inactive
        self.updateCollectors({service_instance_id: serviceResult.id}, {active: false}).then(function() {
          models.db.ServiceInstance.destroy({where: restriction}).then(function() {
            resolve();
          }).catch(function(err) {
            console.log(err);
            reject(new Error("Could not remove service instance. " + err.message));
          });
        }).catch(function(err) {
          reject(err);
        });
      }).catch(function(err) {
        reject(err);
      });

    });
  },

  updateServiceInstance: function(serviceId, serviceObject) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.getServiceInstance({id: serviceId}).then(function(serviceResult) {
        models.db.ServiceInstance.update(serviceObject, {
          fields: ['name', 'description', 'port', 'numberOfThreads', 'runEnviroment', 'host', 'sshUser', 'sshPort', 'pathToBinary'],
          where: { id: serviceId }
        }).then(function() {
          resolve();
        }).catch(function(err) {
          reject(err);
        });
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  updateLog: function(logId, logObject) {
    return new Promise(function(resolve, reject) {
      models.db.Log.update(logObject, {
        fields: ['host', 'port', 'user', 'database'],
        where: {
          id: logId
        }
      }).then(function() {
        resolve();
      }).catch(function(err) {
        reject(new Error("Could not update log " + err.toString()));
      });
    });
  },

  /**
   * It saves DataProviderType in database.
   *
   * @param {Object} dataProviderTypeObject - An object containing needed values to create DataProviderType object.
   * @return {Promise} - a 'bluebird' module with semantics instance or error callback.
   */
  addDataProviderType: function(dataProviderTypeObject) {
    return new Promise(function(resolve, reject) {
      models.db.DataProviderType.create(dataProviderTypeObject).then(function(result) {
        resolve(Utils.clone(result.get()));
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  /**
   * It retrieves a DataProviderType list object from database.
   *
   * @return {Promise<DataProviderType>} - a 'bluebird' module with DataProviderType instance or error callback
   */
  listDataProviderType: function() {
    return new Promise(function(resolve, reject) {
      models.db.DataProviderType.findAll({}).then(function(result) {
        var output = [];
        result.forEach(function(element) {
          output.push(Utils.clone(element.get()));
        });

        resolve(output);
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  /**
   * It retrieves a DataProviderType object from database.
   *
   * @return {Promise<DataProviderType>} - a 'bluebird' module with DataProviderType instance or error callback
   */
  getDataProviderType: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.DataProviderType.findOne({where: restriction}).then(function(typeResult) {
        resolve(typeResult.get());
      }).catch(function(err) {
        console.log(err);
        reject(new Error("Could not retrieve DataProviderType " + err.message));
      });
    });
  },

  /**
   * It retrieves a DataProviderIntent object from database.
   *
   * @return {Promise<DataProviderIntent>} - a 'bluebird' module with DataProviderIntent instance or error callback
   */
  getDataProviderIntent: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.DataProviderIntent.findOne({where: restriction}).then(function(intentResult) {
        resolve(intentResult.get());
      }).catch(function(err) {
        console.log(err);
        reject(new Error("Could not retrieve DataProviderIntent " + err.message));
      });
    });
  },

  /**
   * It saves DataFormat in database.
   *
   * @param {Object} dataFormatObject - An object containing needed values to create DataFormatObject object.
   * @return {Promise} - a 'bluebird' module with semantics instance or error callback.
   */
  addDataFormat: function(dataFormatObject) {
    return new Promise(function(resolve, reject) {
      models.db.DataFormat.create(dataFormatObject).then(function(result) {
        resolve(Utils.clone(result.get()));
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  /**
   * It retrieves a DataFormats list object from database.
   *
   * @return {Promise<DataFormat>} - a 'bluebird' module with DataFormat instance or error callback
   */
  listDataFormats: function() {
    return new Promise(function(resolve, reject) {
      models.db.DataFormat.findAll({}).then(function(dataFormats) {
        var output = [];

        dataFormats.forEach(function(dataFormat){
          output.push(Utils.clone(dataFormat.get()));
        });

        resolve(output);
      }).catch(function(err) {
        reject(new exceptions.DataFormatError("Could not retrieve data format", err));
      });
    });
  },

  /**
   * It saves DataSeriesSemantics in database.
   *
   * @param {Object} semanticsObject - An object containing needed values to create DataSeriesSemantics object.
   * @return {Promise<Object>} - a 'bluebird' module with semantics instance or error callback.
   */
  addDataSeriesSemantics: function(semanticsObject) {
    return new Promise(function(resolve, reject){
      models.db.DataSeriesSemantics.create(semanticsObject).then(function(semantics){
        resolve(Utils.clone(semantics.get()));
      }).catch(function(e) {
        reject(e);
      });
    });
  },

  /**
   * It retrieves a DataSeriesSemantics object from restriction. It should be an object containing either id identifier or
   * name identifier. This operation must retrieve only a row.
   *
   * @param {Object} restriction - An object containing DataSeriesSemantics identifier to get it.
   * @return {Promise<DataSeriesSemantics>} - a 'bluebird' module with DataSeriesSemantics instance or error callback
   */
  getDataSeriesSemantics: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.listDataSeriesSemantics(restriction).then(function(semanticsList) {
        if (semanticsList.length === 1) { return resolve(semanticsList[0]); }

        // error getting more than one or none
        return reject(new exceptions.DataSeriesSemanticsError("DataSeriesSemantics not found"));
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  /**
   * It retrieves a DataSeriesSemantics list object from restriction.
   *
   * @param {Object} restriction - An optional object containing DataSeriesSemantics identifier to filter it.
   * @return {Promise<DataSeriesSemantics>} - a 'bluebird' module with DataSeriesSemantics instance or error callback
   */
  listDataSeriesSemantics: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.DataSeriesSemantics.findAll({where: restriction}).then(function(semanticsList) {
        var output = [];

        semanticsList.forEach(function(semantics) {
          output.push(Utils.clone(semantics.get()));
        });

        resolve(output);
      }).catch(function(err) {
        reject(new exceptions.DataSeriesSemanticsError("Could not retrieve data series semantics ", err));
      });
    });
  },

  listSemanticsProvidersType: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.SemanticsProvidersType.findAll({where: restriction}).then(function(semanticsProvidersResult) {
        var output = [];
        semanticsProvidersResult.forEach(function(element) {
          output.push(element.get());
        });
        resolve(output);
      }).catch(function(err) {
        console.log(err);
        reject(err);
      });
    });
  },

  /**
   * It saves DataProvider in database and load it in memory
   * @param {Object} dataProviderObject - An object containing needed values to create DataProvider object.
   * @return {Promise<DataProvider>} - a 'bluebird' module with DataProvider instance or error callback
   */
  addDataProvider: function(dataProviderObject, options) {
    var self = this;
    return new Promise(function(resolve, reject) {
      return models.db.DataProvider.create(dataProviderObject, options).then(function(dataProvider){
        return dataProvider.getDataProviderType().then(function(dataProviderType) {
          var dProvider = new DataModel.DataProvider(dataProvider.get());
          dProvider.data_provider_type = dataProviderType.get();
          self.data.dataProviders.push(dProvider);

          var d = new DataModel.DataProvider(dProvider);

          // sending to all services
          self.listServiceInstances().then(function(servicesInstance) {
            var dataToSend = {"DataProviders": [d.toObject()]};

            servicesInstance.forEach(function(service) {
              try {
                TcpManager.emit('sendData', service, dataToSend);
              } catch (e) {

              }
            });
          }).catch(function(err) {
            reject(err);
          });

          return resolve(dProvider);
        }).catch(function(err) {
          console.log(err);
          reject(err);
        });
      }).catch(function(err){
        var message = "Could not save data provider due: ";
        console.log(err.errors)
        if (err.errors) {
          err.errors.forEach(function(e) { message += e.message + "; "; });
        } else {
          message += err.message;
        }
        reject(new exceptions.DataProviderError(message, err.errors));
      });
    });
  },

  /**
   * It retrieves a DataProvider object from restriction. It should be an object containing either id identifier or
   * name identifier.
   *
   * @param {Object} restriction - An object containing DataProvider identifier to get it.
   * @return {Promise<DataProvider>} - a 'bluebird' module with DataProvider instance or error callback
   */
  getDataProvider: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var opts = Object.assign({}, {
        include: [ models.db.DataProviderType ],
        where: restriction
      }, options);

      models.db.DataProvider.findOne(opts).then(function(dataProvider) {
        if (dataProvider === null) {
          return reject(new exceptions.DataProviderError("Could not get data provider: result null"));
        }

        return resolve(new DataModel.DataProvider(dataProvider.get()));
      }).catch(function(err) {
        return reject(new exceptions.DataProviderError("Could not get data provider due " + err.toString()));
      });
    });
  },

  /**
   * It retrieves DataProviders loaded in memory.
   *
   * @param {Object} restriction - An object containing DataProvider filter values
   * @return {Array<DataProvider>} - An array with DataProviders available/loaded in memory.
   */
  listDataProviders: function(restriction, options) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var opts = Object.assign({}, {
        include: [ models.db.DataProviderType ],
        where: restriction
      }, options);

      models.db.DataProvider.findAll(opts).then(function(dataProvidersResult) {
        var output = [];
        dataProvidersResult.forEach(function(dataProvider) {
          output.push(new DataModel.DataProvider(dataProvider.get()));
        });
        return resolve(output);
      }).catch(function(err) {
        return reject(new exceptions.DataProviderError("Could not retrieve data providers due " + err.toString()));
      });
    });
  },

  /**
   * It updates a DataProvider instance from object.
   *
   * @param {Object} restriction - A DataProvider identifier restriction to get it.
   * @param {Object} dataProviderObject - An object containing DataProvider to update.
   * @return {Promise} - a 'bluebird' module with DataProvider instance or error callback
   */
  updateDataProvider: function(restriction, dataProviderObject, options) {
    var self = this;
    return new Promise(function(resolve, reject) {
      models.db.DataProvider.update(dataProviderObject, Object.assign({}, {
        fields: ["name", "description", "uri", "active"],
        where: restriction
      }, options)).then(function() {
        self.listServiceInstances({}, options).then(function(services) {
          services.forEach(function(service) {
            try {
              console.log("Sending Add_signal to update");
              TcpManager.emit('sendData', service, {
                "DataProviders": [dataProvider.toObject()]
              });
            } catch (e) {

            }
          });
        }).catch(function(err) { });

        return resolve(new DataModel.DataProvider(dataProvider));
      }).catch(function(err) {
        return reject(new exceptions.DataProviderError("Could not update data provider ", err));
      });
    });
  },

  /**
   * It removes DataProvider from param. It should be an object containing either id identifier or
   * name identifier.
   *
   * @param {Object} dataProviderParam - An object containing DataProvider identifier to get it.
   * @param {Boolean} cascade - A bool value to delete on cascade
   * @return {Promise} - a 'bluebird' module with DataProvider instance or error callback
   */
  removeDataProvider: function(dataProviderParam, cascade) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if (!cascade) { cascade = false; }

      var provider = Utils.remove(self.data.dataProviders, dataProviderParam);
      if (provider) {
        models.db.DataProvider.destroy({where: {id: provider.id}}).then(function() {
          var objectToSend = {
            "DataProvider": [provider.id],
            "DataSeries": []
          };
          self.listServiceInstances({}).then(function(services) {
            // remove data series
            var dataSeriesList = Utils.removeAll(self.data.dataSeries, {data_provider_id: provider.id});
            dataSeriesList.forEach(function(dataSeries) {
              var dSets = Utils.removeAll(self.data.dataSets, {data_series_id: dataSeries.id});
            });

            // sending Remove signal
            services.forEach(function(service) {
              try {
                TcpManager.emit('removeData', service, objectToSend);
              } catch (e) {
                console.log(e);
              }
            });

            resolve();
          }).catch(function(err) {
            console.log(err);
            reject(err);
          });
        }).catch(function(err) {
          console.log(err);
          reject(new exceptions.DataProviderError("Could not remove DataProvider with a collector associated", err));
        });
      } else {
        reject(new exceptions.DataManagerError("DataProvider not found"));
      }
    });
  },

  /**
   * It retrieves a DataSeries object from restriction. It should be an object containing either id identifier or
   * name identifier.
   *
   * @param {Object} restriction - An object containing DataSeries identifier to get it.
   * @return {Promise} - a 'bluebird' module with DataSeries instance or error callback
   */
  getDataSeries: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var dataSerie = Utils.find(self.data.dataSeries, restriction);
      if (dataSerie) {
        resolve(new DataModel.DataSeries(dataSerie));
      } else {
        reject(new exceptions.DataSeriesError("Could not find a data series: " + restriction[Object.keys(restriction)]));
      }
    });
  },

  /**
   * It retrieves DataSeries from database
   *
   * @param {Object} restriction - an object to filter result
   * @return {Promise<Array<DataSeries>>} - An array with DataSeries available/loaded in memory.
   */
  listDataSeries: function(restriction) {
    var self = this;
    if (!restriction) { restriction = {}; }

    return new Promise(function(resolve, reject) {
      var dataSeriesList = [];
      if (restriction.hasOwnProperty("schema")) {
        if (restriction.schema === "all") {
          self.listDataSeries({"Collector": restriction}).then(function(data) {
            self.listDataSeries({
              data_series_semantics: { data_series_type_name: Enums.DataSeriesType.STATIC_DATA }
            }).then(function(staticData) {
              var output = [];
              data.forEach(function(d) {
                output.push(d);
              });
              staticData.forEach(function(d) {
                output.push(d);
              });

              return resolve(output);
            }).catch(function(err) {
              reject(err);
            });
          }).catch(function(err) {
            reject(err);
          });
        }
      } else if (restriction && restriction.hasOwnProperty("Collector")) {
        // collector restriction
        self.listCollectors({}).then(function(collectorsResult) {
          var collectorFilter = new Filters.CollectorFilter();
          var output = collectorFilter.match(collectorsResult, {
            dataSeries: self.data.dataSeries
          });

          var copyRestriction = Utils.makeCopy(restriction, null);
          delete copyRestriction.Collector;
          // collect output and processing
          return resolve(Utils.filter(output, copyRestriction));
        }).catch(function(err) {
          return reject(err);
        });
      } else {
        var dataSeriesFound = Utils.filter(self.data.dataSeries, restriction);
        dataSeriesFound.forEach(function(dataSeries) {
          dataSeriesList.push(new DataModel.DataSeries(dataSeries));
        });
        return resolve(dataSeriesList);
      }
    });
  },

  /**
   * It saves a DataSeries object in database. It also saves DataSet if there are.
   *
   * @param {Object} dataSeriesObject - An object containing DataSeries values to save it.
   * @return {Promise} - a 'bluebird' module with DataSeries instance or error callback
   */
  addDataSeries: function(dataSeriesObject, analysisType, options) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var output;
      return models.db.DataSeries.create(dataSeriesObject, options).then(function(dataSerie){
        var obj = dataSerie.get();

        var rollback = function(err) {
          return dataSerie.destroy().then(function () {
            return reject(err);
          });
        };

        // getting semantics
        return dataSerie.getDataSeriesSemantic().then(function(dataSemantics) {
          obj.DataSeriesSemantic = dataSemantics;
          output = new DataModel.DataSeries(obj);

          // if there DataSets to save too
          if (dataSeriesObject.dataSets || dataSeriesObject.dataSets.length > 0) {
            var dataSets = [];
            for(var i = 0; i < dataSeriesObject.dataSets.length; ++i) {
              var dSet = dataSeriesObject.dataSets[i];
              dSet.data_series_id = dataSerie.id;
              dataSets.push(self.addDataSet(dataSemantics.get(), dSet, analysisType, options));
            }

            return Promise.all(dataSets).then(function(dataSets){
              var dataSeriesInstance = new DataModel.DataSeries(output);
              dataSeriesInstance.dataSets = dataSets;
              self.data.dataSeries.push(dataSeriesInstance);

              // get DataProvider object
              return self.getDataProvider({id: dataSerie.data_provider_id}).then(function(dProvider) {
                dataSeriesInstance.setDataProvider(dProvider);

                // resolving promise
                return resolve(dataSeriesInstance);
              });
            }).catch(function(err) {
              return rollback(err);
            });
          } else {
            // rollback data series
            return rollback(new exceptions.DataSeriesError("Could not save DataSeries without any data set."));
          }
        }).catch(function(err) {
          return rollback(err);
        });
      }).catch(function(err){
        console.log(err);
        return reject(new exceptions.DataSeriesError("Could not save data series due: ", err.errors || []));
      });
    });
  },

  /**
   * It updates a DataSeries object. It should be an object containing object filled out with identifier
   * and model values.
   *
   * @param {Number} dataSeriesId - A DataSeries id
   * @param {Object} dataSeriesObject - An object containing DataSeries identifier to get it.
   * @return {Promise} - a 'bluebird' module with DataSeries instance or error callback
   */
  updateDataSeries: function(dataSeriesId, dataSeriesObject) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var dataSeries = Utils.find(self.data.dataSeries, {id: dataSeriesId});

      if (dataSeries) {
        models.db.DataSeries.update(dataSeriesObject, {
          fields: ['name', 'description', 'data_provider_id'],
          where: {
            id: dataSeriesId
          }
        }).then(function() {
          self.getDataProvider({id: parseInt(dataSeriesObject.data_provider_id)}).then(function(dataProvider) {
            dataSeries.name = dataSeriesObject.name;
            dataSeries.description = dataSeriesObject.description;
            dataSeries.data_provider_id = dataProvider.id;

            resolve(new DataModel.DataSeries(dataSeries));
          }).catch(function(err) {
            console.log(err);
            reject(err);
          });
        }).catch(function(err) {
          reject(new exceptions.DataSeriesError("Could not update data series ", err.errors));
        });
      } else {
        reject(new exceptions.DataSeriesError("Data series not found. ", []));
      }
    });
  },

  /**
   * It removes a DataSeries object. It should be an object containing object filled out with identifier
   * and model values.
   *
   * @param {Object} dataSeriesParam - An object containing DataSeries identifier to remove it.
   * @return {Promise} - a 'bluebird' module with DataSeries instance or error callback
   */
  removeDataSerie: function(dataSeriesParam) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var dataSeries = Utils.remove(self.data.dataSeries, dataSeriesParam);

      if (dataSeries) {
        models.db.DataSeries.destroy({where: {
          id: dataSeries.id
        }}).then(function (status) {
          // Removing data set from memory. Its not necessary to remove in database, since on remove cascade is enabled.
          Utils.removeAll(self.data.dataSets, {data_series_id: dataSeries.id});
          resolve(status);
        }).catch(function (err) {
          console.log(err);
          reject(new exceptions.DataSeriesError("Could not remove DataSeries " + err.message));
        });
      } else {
        reject(new exceptions.DataSeriesError("Data series not found"));
      }
    });
  },

  /**
   * It saves a DataSet object in database. The object syntax is:
   * @example
   * {
   *   "id" : INT,
   *   "data_series_id" : INT,
   *   "active" : BOOL,
   *   "format" : {...},
   *   "position" : GeoJSON object syntax
   * }
   *
   * @param {string} dataSeriesSemantic - A string value representing DataSet type. (dcp, occurrence, grid).
   * @param {Array<Object>} dataSetObject - An object containing DataSet values to save it.
   * @return {Promise} - a 'bluebird' module with DataSeries instance or error callback
   */
  addDataSet: function(dataSeriesSemantic, dataSetObject, analysisType, options) {
    var self = this;
    return new Promise(function(resolve, reject) {
      return models.db.DataSet.create({
        active: dataSetObject.active,
        data_series_id: dataSetObject.data_series_id
      }, options).then(function(dataSet) {

        var onSuccess = function(dSet) {
          var output;
          output = DataModel.DataSetFactory.build(Object.assign(Utils.clone(dSet.get()), dataSet.get()));
          console.log(output);
          output.semantics = dataSeriesSemantic;

          // save dataformat
          if (dataSetObject.format) {
            var formats = dataSetObject.format;
            var formatList = [];

            if (formats instanceof Array) {
              formatList = formats;
            } else if (formats instanceof Object) {
              for(var key in formats) {
                if (formats.hasOwnProperty(key)) {
                  formatList.push({
                    data_set_id: dataSet.id,
                    key: key,
                    value: formats[key]
                  });
                }
              }
            }

            return models.db.DataSetFormat.bulkCreate(formatList, 
              Utils.extend(Object.assign({}, options), {data_set_id: dataSet.id})).then(function () {
              return models.db.DataSetFormat.findAll(Utils.extend(Object.assign({}, options), {where: {data_set_id: dataSet.id}})).then(function(dataSetFormats) {
                output.format = {};
                dataSetFormats.forEach(function(dataSetFormat) {
                  output.format[dataSetFormat.key] = dataSetFormat.value;
                });

                //  if analysis, add input dataseries id
                if (analysisType && analysisType.data_series_id) {
                  output.format.monitored_object_dataseries_id = analysisType.data_series_id;
                }
                self.data.dataSets.push(output);
                return resolve(output);
              });
            }).catch(function (err) {
              console.log(err);
              return reject(new exceptions.DataFormatError("Could not save data format: ", err));
            });
          } else {// todo: validate it
            self.data.dataSets.push(output);
            return resolve(output);
          }
        };

        var onError = function(err) {
          console.log(err);
          return reject(new exceptions.DataSetError("Could not save data set." + err.message));
        };

        // rollback data set function if any error occurred
        var rollback = function(dataSet) {
          return dataSet.destroy().then(function() {
            console.log("rollback");
            return reject(new exceptions.DataSetError("Invalid data set type. DataSet destroyed"));
          }).catch(onError);
        };

        if (dataSeriesSemantic && dataSeriesSemantic instanceof Object) {
          switch(dataSeriesSemantic.data_series_type_name) {
            case DataSeriesType.DCP:
              var dataSetDcp = {
                data_set_id: dataSet.id,
                position: dataSetObject.position
              };
              return models.db.DataSetDcp.create(dataSetDcp, options).then(function(dSetDcp) {
                // TODO: reuse it. It retrieving entire GeoJSON representation (with SRID)
                models.db.DataSetDcp.findOne(Utils.extend(Object.assign({}, options), {
                  attributes: [
                    "id",
                    "data_set_id",
                    [orm.fn('ST_AsGeoJSON', orm.col('position'), 0, 2), 'position'],
                    [orm.fn('ST_AsEwkt', orm.col('position')), 'positionWkt']
                  ],
                  where: {
                    id: dSetDcp.id
                  }
                })).then(onSuccess).catch(onError);
              }).catch(onError);
            case DataSeriesType.OCCURRENCE:
              return models.db.DataSetOccurrence.create({data_set_id: dataSet.id}, options).then(onSuccess).catch(onError);
            case DataSeriesType.STATIC_DATA:
              return onSuccess(dataSet);
            case DataSeriesType.GRID:
              return models.db.DataSetGrid.create({data_set_id: dataSet.id}, options).then(onSuccess).catch(onError);
              
            case DataSeriesType.ANALYSIS_MONITORED_OBJECT:
              return models.db.DataSetMonitored.create({data_set_id: dataSet.id}, options).then(onSuccess).catch(onError);
            default:
              return rollback(dataSet);
          }
        } else {
          return rollback(dataSet);
        }
      }).catch(function(err) {
        return reject(err);
      });
    });
  },

  /**
   * It retrieves a DataSet object. It should be an object containing object filled out with identifier
   * and model values.
   *
   * getDataSet({id: 1}, 'GeoJSON').then(function(dataSet) {
   *   ... do some operation
   * }).catch(function(err) {
   *   .. an exception occurred
   * });
   *
   * @param {Object} restriction - An object containing DataSet identifier to get it and type of DataSet.
   * @param {Format} format - A format to describe which format should be retrieve. Default: GeoJSON.
   * @return {Promise} - a 'bluebird' module with DataSeries instance or error callback
   */
  getDataSet: function(restriction, format) {
    var self = this;
    return new Promise(function(resolve, reject) {
      // setting default format
      if (format === undefined) { format = Enums.Format.GEOJSON; }

      if (format !== Enums.Format.GEOJSON && format !== Enums.Format.WKT) {
        return reject(new exceptions.DataSetError("Invalid output format while retrieving dataset"));
      }

      lock.readLock(function (release) {
        var dataSet = Utils.find(self.data.dataSets, restriction);
        if (dataSet) {
          var output = DataModel.DataSetFactory.build(dataSet);

          if (output.position && format === Enums.Format.WKT) {
            // Getting wkt representation of Point from GeoJSON
            self.getWKT(output.position).then(function (wktGeom) {
              output.positionWkt = wktGeom;
              resolve(output);
            }).catch(function (err) {
              reject(err);
            }).finally(function() { release(); });
          } else {
            resolve(output);
            release();
          }
        }
        else {
          reject(new exceptions.DataSetError("Could not find a data set: ", restriction));
        }
        release();
      });
    });
  },

  /**
   * It updates a DataSet object. It should be an object containing object filled out with identifier
   * and model values.
   *
   * @param {Object} restriction - An object containing DataSeries identifier to get it.
   * @param {Object} dataSetObject - An object containing DataSet values to be updated.
   * @return {Promise} - a 'bluebird' module with DataSeries instance or error callback
   */
  updateDataSet: function(restriction, dataSetObject) {
    var self = this;
    return new Promise(function(resolve, reject) {

      var dataSet = Utils.find(self.data.dataSets, restriction);

      if (dataSet) {

        models.db.DataSet.find({id: dataSet.id}).then(function(result) {
          result.updateAttributes({active: dataSetObject.active}).then(function() {
            result.getDataSet(restriction.semantics.data_series_type_name).then(function(dSet) {
              dSet.updateAttributes(dataSetObject).then(function() {
                var output = Utils.clone(result.get());
                output.class = "DataSet";
                switch (restriction.semantics.data_series_type_name) {
                  case DataSeriesType.DCP:
                    output.position = Utils.clone(dSet.position);
                    break;
                  default:
                }
                resolve(output);
              }).catch(function(err) {
                reject(err);
              });
            });
          }).catch(function(err) {
            reject(err);
          });
        }).catch(function(err) {
          reject(err);
        });

      } else {
        reject(new exceptions.DataSeriesError("Could not find a data set: ", restriction));
      }
    });
  },

  /**
   * It removes a DataSet from database.
   *
   * @param {Object} dataSetId - An object containing Dataset identifier. {id: someValue}
   * @return {Promise} - a 'bluebird' module callback
   */
  removeDataSet: function(dataSetId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      for(var index = 0; index < self.data.dataSets.length; ++index) {
        var dataSet = self.data.dataSets[index];
        if (dataSet.id === dataSetId.id) {
          models.db.DataSet.destroy({where: {id: dataSet.id}}).then(function(status) {
            resolve(status);
            self.data.dataSets.splice(index, 1);
          }).catch(function(err) {
            reject(err);
          });
          return;
        }
      }

      reject(new exceptions.DataSetError("Data set not found."));
    });
  },

  /**
   * It retrieves a list of DataSets in memory.
   *
   * @return {Array<DataSet>} - a 'bluebird' module with DataSeries instance or error callback
   */
  listDataSets: function() {
    var dataSetsList = [];
    for(var index = 0; index < this.data.dataSets.length; ++index) {
      dataSetsList.push(Utils.clone(this.data.dataSets[index]));
    }

    return dataSetsList;
  },

  addDataSeriesAndCollector: function(dataSeriesObject, scheduleObject, filterObject, serviceObject, intersectionArray, active) {
    var self = this;

    return new Promise(function(resolve, reject) {
      self.addDataSeries(dataSeriesObject.input).then(function(dataSeriesResult) {
        self.addDataSeries(dataSeriesObject.output).then(function(dataSeriesResultOutput) {
          self.addSchedule(scheduleObject).then(function(scheduleResult) {
            var schedule = new DataModel.Schedule(scheduleResult);
            var collectorObject = {};

            // todo: get service_instance id and collector status (active)
            collectorObject.data_series_input = dataSeriesResult.id;
            collectorObject.data_series_output = dataSeriesResultOutput.id;
            collectorObject.service_instance_id = serviceObject.id;
            collectorObject.schedule_id = scheduleResult.id;
            collectorObject.active = active;
            collectorObject.collector_type = 1;
            collectorObject.schedule_id = scheduleResult.id;

            self.addCollector(collectorObject, filterObject).then(function(collectorResult) {
              var collector = collectorResult;

              // checking for intersection
              if (!intersectionArray) {
                resolve({
                  collector: collector,
                  input: dataSeriesResult,
                  output:dataSeriesResultOutput,
                  schedule: schedule
                });
              } else {
                intersectionArray.forEach(function(intersect) {
                  intersect.collector_id = collector.id;
                });
                models.db.Intersection.bulkCreate(intersectionArray, {returning: true}).then(function(bulkIntersectionResult) {
                  collector.setIntersection(bulkIntersectionResult);
                  resolve({
                    collector: collector,
                    input: dataSeriesResult,
                    output:dataSeriesResultOutput,
                    schedule: schedule,
                    intersection: bulkIntersectionResult
                  });
                }).catch(function(err) {
                  Utils.rollbackPromises([
                    self.removeDataSerie(dataSeriesResult),
                    self.removeDataSerie(dataSeriesResultOutput),
                    self.removeSchedule({id: scheduleResult.id})
                  ], new exceptions.AnalysisError("Could not save data series"), reject);
                });
              }
            }).catch(function(err) {
              // rollback schedule
              console.log("rollback schedule");
              Utils.rollbackPromises([
                self.removeSchedule(scheduleResult),
                self.removeDataSerie(dataSeriesResult),
                self.removeDataSerie(dataSeriesResultOutput)
              ], err, reject);
            });
          }).catch(function(err) {
            // rollback data series
            console.log("rollback data series in out");
            console.log(err);
            Utils.rollbackPromises([
              self.removeDataSerie(dataSeriesResultOutput),
              self.removeDataSerie(dataSeriesResult)
            ], err, reject);
          });
        }).catch(function(err) {
          console.log("rollback data series");
          Utils.rollbackPromises([self.removeDataSerie(dataSeriesResult)], err, reject);
        });
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  addSchedule: function(scheduleObject, options) {
    return new Promise(function(resolve, reject) {
      return models.db.Schedule.create(scheduleObject, options).then(function(schedule) {
        return resolve(new DataModel.Schedule(schedule.get()));
      }).catch(function(err) {
        // todo: improve error message
        return reject(new exceptions.ScheduleError("Could not save schedule. " + err.toString()));
      });
    });
  },

  updateSchedule: function(scheduleId, scheduleObject) {
    return new Promise(function(resolve, reject) {
      models.db.Schedule.update(scheduleObject, {
        fields: ['schedule', 'schedule_time', 'schedule_unit', 'frequency_unit', 'frequency', 'frequency_start_time'],
        where: {
          id: scheduleId
        }
      }).then(function() {
        resolve();
      }).catch(function(err) {
        reject(new exceptions.ScheduleError("Could not update schedule " + err.toString()));
      });
    });
  },

  removeSchedule: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.Schedule.destroy({where: {id: restriction.id}}).then(function() {
        resolve();
      }).catch(function(err) {
        console.log(err);
        reject(new exceptions.ScheduleError("Could not remove schedule " + err.message));
      });
    });
  },

  getSchedule: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      models.db.Schedule.findOne({
        where: restriction || {}
      }).then(function(schedule) {
        if (schedule) {
          return resolve(new DataModel.Schedule(schedule.get()));
        }
        reject(new exceptions.ScheduleError("Could not find schedule"));
      });
    });
  },

  addCollector: function(collectorObject, filterObject, options) {
    var self = this;

    return new Promise(function(resolve, reject) {
      models.db.Collector.create(collectorObject, options).then(function(collectorResult) {
        var collector = new DataModel.Collector(collectorResult.get());

        return self.getSchedule({id: collectorResult.schedule_id}, options).then(function(schedule) {
          return self.getDataSeries({id: collectorResult.data_series_input}).then(function(dataSeriesInput) {
            return self.getDataSeries({id: collectorResult.data_series_output}).then(function(dataSeriesOutput) {
              var inputOutputArray = [];

              for(var i = 0; i < dataSeriesInput.dataSets.length; ++i) {
                var inputDataSet = dataSeriesInput.dataSets[i];
                var outputDataSet;
                if (dataSeriesOutput.dataSets.length === 1) {
                  outputDataSet = dataSeriesOutput.dataSets[0];
                } else {
                  outputDataSet = dataSeriesOutput.dataSets[i];
                }

                inputOutputArray.push({
                  collector_id: collectorResult.id,
                  input_dataset: inputDataSet.id,
                  output_dataset: outputDataSet.id
                });
              }

              return models.db.CollectorInputOutput.bulkCreate(inputOutputArray, options).then(function(bulkInputOutputResult) {
                var input_output_map = [];
                bulkInputOutputResult.forEach(function(bulkResult) {
                  input_output_map.push({
                    input: bulkResult.input_dataset,
                    output: bulkResult.output_dataset
                  });
                });
                collector.input_output_map = input_output_map;
                collector.schedule = schedule;

                if (_.isEmpty(filterObject)) {
                  return resolve(collector);
                }

                if (_.isEmpty(filterObject.date) && _.isEmpty(filterObject.region||{})) {
                  return resolve(collector);
                } else {
                  filterObject.collector_id = collectorResult.id;

                  return self.addFilter(filterObject, options).then(function(filterResult) {
                    collector.filter = filterResult;
                    return resolve(collector);
                  }).catch(function(err) {
                    console.log(err);
                    return reject(new exceptions.CollectorError("Could not save collector filter: " + err.toString()));
                  });
                }
              }).catch(function(err) {
                console.log(err);
                return reject(new exceptions.CollectorError("Could not save collector input/output " + err.toString()));
              });
            });
          });
        });
      }).catch(function(err) {
        console.log(err);
        reject(new exceptions.CollectorError("Could not save collector: ", err));
      });
    });
  },

  updateCollectors: function(restriction, values, extra) {
    return new Promise(function(resolve, reject) {
      var options = Object.assign({
        where: restriction
      }, extra instanceof Object ? extra : {});

      models.db.Collector.update(values, options).then(function() {
        resolve();
      }).catch(function(err) {
        console.log(err);
        reject(new exceptions.CollectorError("Could not update collector" + err.message));
      });
    });
  },

  updateCollector: function(collectorId, collectorObject) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var fields = [
        'service_instance_id',
        'data_series_input',
        'data_series_output',
        'schedule_id',
        'active',
        'collector_type'
      ];

      self.updateCollectors({id: collectorId}, collectorObject, {fields: fields}).then(function() {
        resolve();
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  listCollectorInputOutput: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      models.db.CollectorInputOutput.findAll({where: restriction || {}}).then(function(inputOutputResult) {
        var output = [];
        inputOutputResult.forEach(function(element) {
          output.push(element.get());
        });
        resolve(output);
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  listCollectors: function(restriction, projectId) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var dataProviderRestriction = {};
      if (restriction && restriction.DataProvider) {
        dataProviderRestriction = restriction.DataProvider;
        delete restriction.DataProvider;
      }

      models.db.Collector.findAll({
        where: restriction,
        include: [
          models.db.Schedule,
          models.db.CollectorInputOutput,
          {
            model: models.db.Filter,
            required: false,
            attributes: { include: [[orm.fn('ST_AsEwkt', orm.col('region')), 'region_wkt']] }
          },
          {
            model: models.db.Intersection,
            required: false
          },
          {
            model: models.db.DataSeries,
            include: {
              model: models.db.DataProvider,
              where: dataProviderRestriction
            }
          }
        ]
      }).then(function(collectorsResult) {
        var output = [];

        var promises = [];
        collectorsResult.forEach(function(collector) {
          promises.push(self.getDataSeries({id: collector.data_series_output}));
        });

        Promise.all(promises).then(function(dataSeriesArray) {
          dataSeriesArray.forEach(function(dataSeries) {
            collectorsResult.some(function(collector) {
              if (collector.data_series_output === dataSeries.id) {
                var collectorInstance = new DataModel.Collector(collector.get());
                collectorInstance.dataSeriesOutput = dataSeries;
                output.push(collectorInstance);

                return true;
              }
            });
          });

          resolve(output);
        }).catch(function(err) {
          console.log(err);
          reject(new exceptions.CollectorError("Could not retrieve collector data series output: " + err.toString()));
        });
      }).catch(function(err) {
        console.log(err);
        reject(new exceptions.CollectorError("Could not retrieve collector: " + err.message));
      });
    });
  },

  getCollector: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var restrictionOutput = {};
      if (restriction.output) {
        Object.assign(restrictionOutput, restriction.output);
        delete restriction.output;
      }

      models.db.Collector.findOne({
        where: restriction,
        include: [
          {
            model: models.db.Schedule
          },
          {
            model: models.db.DataSeries,
            where: restrictionOutput
          },
          {
            model: models.db.CollectorInputOutput
          },
          {
            model: models.db.Filter,
            required: false,
            attributes: { include: [[orm.fn('ST_AsEwkt', orm.col('region')), 'region_wkt']] }
          },
          {
            model: models.db.Intersection,
            required: false
          }
        ]
      }).then(function(collectorResult) {
        if (collectorResult) {
          var collectorInstance = new DataModel.Collector(collectorResult.get());

          self.getDataSeries({id: collectorResult.data_series_output}).then(function(dataSeries) {
            collectorInstance.dataSeriesOutput = dataSeries;
            return resolve(collectorInstance);
          }).catch(function(err) {
            console.log("Retrieved null while getting collector");
            return reject(new exceptions.CollectorError("Could not find collector. " + err.toString()));
          });
        } else {
          console.log("Retrieved null while getting collector");
          return reject(new exceptions.CollectorError("Could not find collector. "));
        }
      }).catch(function(err) {
        console.log(err);
        return reject(new exceptions.CollectorError("Could not find collector. " + err.toString()));
      });
    });
  },

  addIntersection: function(intersectionArray) {
    return new Promise(function(resolve, reject) {
      models.db.Intersection.bulkCreate(intersectionArray, {returning: true}).then(function(intesectionList) {
        var output = [];
        intesectionList.forEach(function(element) {
          output.push(new DataModel.Intersection(element.get()));
        });
        resolve(output);
      }).catch(function(err) {
        reject(new Error("Could not save intersection. " + err.toString()));
      });
    });
  },

  updateIntersection: function(intersectionId, intersectionObject) {
    return new Promise(function(resolve, reject) {
      models.db.Intersection.update(intersectionObject, {
        fields: ['attribute'],
        where: {
          id: intersectionId
        }
      }).then(function() {
        resolve();
      }).catch(function(err) {
        reject(new Error("Could not update intersection " + err.toString()));
      });
    });
  },

  updateIntersections: function(intersectionIds, intersectionList) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var promises = [];
      intersectionList.forEach(function(element, index) {
        promises.push(self.updateIntersection(intersectionIds[index], element));
      });
      Promise.all(promises).then(function() {
        resolve();
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  listIntersections: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.Intersection.findAll(restriction).then(function(intersectionResult) {
        var output = [];
        intersectionResult.forEach(function(element) {
          output.push(element.get());
        });
        resolve(output);
      }).catch(function(err) {
        reject(new Error("Could not retrieve intersection " + err.toString()));
      });
    });
  },

  removeIntersection: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.Intersection.destroy({where: restriction}).then(function() {
        resolve();
      }).catch(function(err) {
        reject(new Error("Could not remove intersection " + err.toString()));
      });
    });
  },

  addFilter: function(filterObject, options) {
    var self = this;

    return new Promise(function(resolve, reject) {
      var filterValues = {collector_id: filterObject.collector_id, region: filterObject.region || null};

      Object.assign(filterValues, _processFilter(filterObject));

      // checking filter
      return models.db.Filter.create(filterValues, options).then(function(filterResult) {
        if (filterResult.region) {
          return self.getFilter({id: filterResult.id}, options).then(function(filterEwkt) {
            return resolve(filterEwkt);
          });
        } else {
          return resolve(new DataModel.Filter(filterResult.get()));
        }
      }).catch(function(err) {
        // todo: improve error message
        console.log(err);
        return reject(new Error("Could not save filter. " + err.toString()));
      });
    });
  },

  getFilter: function(restriction, options) {
    var self = this;
    return new Promise(function(resolve, reject) {
      models.db.Filter.findOne(Object.assign({}, {
        attributes: {include: [[orm.fn('ST_AsEwkt', orm.col('region')), 'region_wkt']]},
        where: restriction
      }, options || {})).then(function(filter) {
        if (filter === null) {
          return reject(new exceptions.FilterError("Could not get filter, retrieved null"));
        }

        var output = new DataModel.Filter(filter.get());
        output.region_wkt = filter.dataValues.region_wkt;

        return resolve(output);
      }).catch(function(err) {
        return reject(new exceptions.FilterError("Could not retrieve filter " + err.toString()));
      });
    });
  },

  updateFilter: function(filterId, filterObject) {
    return new Promise(function(resolve, reject) {
      var filterValues = _processFilter(filterObject);
      models.db.Filter.update(filterValues, {
        fields: ['frequency', 'frequency_unit', 'discard_before', 'discard_after', 'region', 'by_value'],
        where: {
          id: filterId
        }
      }).then(function() {
        resolve();
      }).catch(function(err) {
        console.log(err);
        reject(new Error("Could not update filter " + err.toString()));
      });
    });
  },

  addAnalysisDataSeries: function(analysisDataSeriesObject) {
    return new Promise(function(resolve, reject) {
      models.db.AnalysisDataSeries.create(analysisDataSeriesObject, {
        include: [models.db.AnalysisDataSeriesMetadata]
      }).then(function(result) {
        var output = new DataModel.AnalysisDataSeries(result);
        resolve(output);
      }).catch(function(err) {
        reject(new exceptions.AnalysisError("Could not save analysis data series " + err.toString()));
      });
    });
  },

  addAnalysisOutputGrid: function(addAnalysisOutputGridObject) {
    var self = this;
    return new Promise(function(resolve, reject) {
      models.db.AnalysisOutputGrid.create(addAnalysisOutputGridObject).then(function(analysisOutGridResult) {
        self.getAnalysisOutputGrid({id: analysisOutGridResult.id}).then(function(outputGrid) {
          resolve(outputGrid);
        });
      }).catch(function(err) {
        console.log(err);
        reject(new exceptions.AnalysisError("Could not save analysis output grid " + err.toString()));
      });
    });
  },

  getAnalysisOutputGrid: function(restriction) {
    return new Promise(function(resolve, reject) {
      models.db.AnalysisOutputGrid.findOne({
        attributes: {include: [[orm.fn('ST_AsEwkt', orm.col('area_of_interest_box')), 'interest_box']]},
        where: restriction
      }).then(function(outputGrid) {
        if (outputGrid === null) {
          return reject(new Error("Analysis output grid not found"));
        }

        var output = new DataModel.AnalysisOutputGrid(outputGrid.get());
        output.areaOfInterestBoxWKT = outputGrid.dataValues.interest_box;
        resolve(output);
      }).catch(function(err) {
        console.log(err);
        return reject(new Error("Analysis output grid not found " + err.toString()));
      })
    });
  },

  addAnalysis: function(analysisObject, options) {
    var self = this;
    return new Promise(function(resolve, reject) {
      return models.db.Analysis.create(analysisObject, options).then(function(analysisResult) {
        return self.getDataSet({id: analysisResult.dataset_output}).then(function(dataSet) {
          return self.getDataSeries({id: dataSet.data_series_id}).then(function(dataSeries) {
            return self.getSchedule({id: analysisResult.schedule_id}, options).then(function(scheduleResult) {
              return analysisResult.getScriptLanguage().then(function(scriptLanguageResult) {
                // creating a variable to make visible in closure
                var analysisDataSeriesArray = Utils.clone(analysisObject.analysisDataSeries);
                // making analysis metadata
                var analysisMetadata = [];
                for(var key in analysisObject.metadata) {
                  if (analysisObject.metadata.hasOwnProperty(key)) {
                    analysisMetadata.push({
                      analysis_id: analysisResult.id,
                      key: key,
                      value: analysisObject.metadata[key]
                    });
                  }
                }

                return models.db.AnalysisMetadata.bulkCreate(analysisMetadata, options).then(function(bulkAnalysisMetadata) {
                  var analysisMetadataOutput = {};
                  bulkAnalysisMetadata.forEach(function(bulkMetadata) {
                    analysisMetadataOutput[bulkMetadata.key] = bulkMetadata.value;
                  });

                  var promises = [];

                  analysisDataSeriesArray.forEach(function(analysisDS) {
                    analysisDS.analysis_id = analysisResult.id;
                    // ignore id
                    delete analysisDS.id;

                    var metadata = [];
                    for(var key in analysisDS.metadata) {
                      if (analysisDS.metadata.hasOwnProperty(key)) {
                        metadata.push({
                          key: key,
                          value: analysisDS.metadata[key]
                        });
                      }
                    }
                    delete analysisDS.metadata;
                    analysisDS.AnalysisDataSeriesMetadata = metadata;

                    promises.push(self.addAnalysisDataSeries(analysisDS, options));
                  });

                  var analysisInstance = new DataModel.Analysis(analysisResult);
                  analysisInstance.setScriptLanguage(scriptLanguageResult);
                  analysisInstance.setSchedule(scheduleResult);
                  analysisInstance.setMetadata(analysisMetadataOutput);
                  analysisInstance.setDataSeries(dataSeries);

                  analysisResult.getAnalysisType().then(function(analysisTypeResult) {
                    analysisInstance.type = analysisTypeResult.get();

                    var _savePromises = function() {
                      return Promise.all(promises).then(function(results) {
                        results.forEach(function(result) {
                          var analysisDataSeries = result;

                          analysisInstance.addAnalysisDataSeries(analysisDataSeries, options);
                        });

                        return resolve(analysisInstance);
                      }).catch(function(err) {
                        console.log(err);
                        // rollback analysis data series
                        return Utils.rollbackPromises([
                          self.removeAnalysis({id: analysisResult.id})
                        ], new exceptions.AnalysisError("Could not save analysis data series " + err.toString()), reject);
                      });
                    };

                    // check for add analysis grid
                    if (analysisTypeResult.id === Enums.AnalysisType.GRID) {
                      var analysisOutputGrid = analysisObject.grid;
                      analysisOutputGrid.analysis_id = analysisResult.id;

                      self.addAnalysisOutputGrid(analysisOutputGrid).then(function(output_grid) {
                        analysisInstance.outputGrid = output_grid;
                        _savePromises();
                      }).catch(function(err) {
                        Utils.rollbackPromises([
                          self.removeAnalysis({id: analysisResult.id})
                        ], err, reject);
                      });
                    } else { _savePromises(); } // end if
                  }); // end get analysis tyoe
                }).catch(function(err) {
                  // rollback analysis metadata
                  Utils.rollbackPromises([
                    self.removeAnalysis({id: analysisResult.id})
                  ], new exceptions.AnalysisError("Could not save analysis metadata " + err.toString()), reject);
                });
              }); // end get script language
            });
          });
        });
      }).catch(function(err) {
        // rollback data series
        console.log(err);
        return reject(new exceptions.AnalysisError("Could not save analysis " + err.toString()));
      });
    });
  },

  updateAnalysis: function(analysisId, analysisObject, scheduleObject) {
    var self = this;
    return new Promise(function(resolve, reject) {
      self.getAnalysis({id: analysisId}).then(function(analysisInstance) {
        models.db.Analysis.update(analysisObject, {
          fields: ['name', 'description', 'instance_id', 'script', 'active'],
          where: {
            id: analysisId
          }
        }).then(function() {
          // updating analysis dataSeries
          var promises = [];

          var toUpdate = analysisObject.analysisDataSeries.filter(function(elm) { return elm.id !== 0; });
          var toRemove = _.differenceWith(analysisInstance.analysis_dataseries_list, toUpdate, function(a, b) {
            return a.id === b.id;
          });

          // TODO: improve this and delete
          analysisObject.analysisDataSeries.some(function(element) {
            if (element.id && element.id > 0) {
              // update
              promises.push(models.db.AnalysisDataSeries.update(element, {
                fields: ['alias'],
                where: {id: element.id}
              }));
            } else {
              // insert
              element.analysis_id = analysisInstance.id;
              delete element.id;
              promises.push(self.addAnalysisDataSeries(element));
            }
          });

          // delete
          toRemove.forEach(function(element) {
            promises.push(models.db.AnalysisDataSeries.destroy({where: {
              id: element.id
            }}));
          });

          Promise.all(promises).then(function() {
            // updating schedule
            self.updateSchedule(analysisInstance.schedule.id, scheduleObject).then(function() {
              if (analysisInstance.type.id === Enums.AnalysisType.GRID) {
                var gridObject = Object.assign({}, analysisInstance.outputGrid.toObject ? analysisInstance.outputGrid.toObject() : analysisInstance.outputGrid);
                // reset
                for(var k in gridObject) {
                  if (gridObject.hasOwnProperty(k)) {
                    gridObject[k] = null;
                  }
                }
                Object.assign(gridObject, analysisObject.grid);
                models.db.AnalysisOutputGrid.update(analysisObject.grid, {
                  fields: ['area_of_interest_box', 'srid', 'resolution_x',
                           'resolution_y', 'interpolation_dummy',
                           'area_of_interest_type', 'resolution_type',
                           'interpolation_method', 'resolution_data_series_id',
                           'area_of_interest_data_series_id'],
                  where: {
                    id: analysisInstance.outputGrid.id
                  }
                }).then(function() {
                  resolve();
                }).catch(function(err) {
                  console.log(err);
                  reject(new exceptions.AnalysisError("Could not update analysis output grid " + err.toString()));
                });
              } else {
                resolve();
              }
            }).catch(function(err) {
              reject(err);
            });
          }).catch(function(err) {
            reject(new exceptions.AnalysisError("Could not update analysis data series " + err.toString()));
          });
        }).catch(function(err) {
          reject(new exceptions.AnalysisError("Could not update analysis. " + err.toString()));
        });
      }).catch(function(err) {
        reject(err);
      });
    });
  },

  listAnalyses: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var _reject = function(err) {
        console.log(err);
        reject(err);
      };

      models.db.Analysis.findAll({
        include: [
          {
            model: models.db.AnalysisDataSeries,
            include: [
              {
                model: models.db.AnalysisDataSeriesMetadata,
                required: false
              }
            ]
          },
          {
            model: models.db.AnalysisOutputGrid,
            attributes: [
              'interpolation_dummy',
              'resolution_x',
              'resolution_y',
              'srid',
              'analysis_id',
              'area_of_interest_type',
              'resolution_type',
              'interpolation_method',
              'resolution_data_series_id',
              'area_of_interest_data_series_id',
              [orm.fn('ST_AsGeoJSON', orm.col('area_of_interest_box'), 0, 2), 'area_of_interest_box'],
              [orm.fn('ST_AsEwkt', orm.col('area_of_interest_box')), 'interest_box'] // extra field
            ],
            required: false
          },
          models.db.AnalysisMetadata,
          models.db.ScriptLanguage,
          models.db.AnalysisType,
          models.db.Schedule
        ],
        where: restriction || {}
      }).then(function(analysesResult) {
        var output = [];
        var promises = [];

        analysesResult.forEach(function(analysis) {
          promises.push(self.getDataSet({id: analysis.dataset_output}));
        });

        Promise.all(promises).then(function(dataSets) {
          promises = [];

          dataSets.forEach(function(dataSet) {
            promises.push(self.getDataSeries({id: dataSet.data_series_id}));
          });

          Promise.all(promises).then(function(dataSeriesList) {
            analysesResult.forEach(function(analysis) {
              var analysisObject = new DataModel.Analysis(analysis.get());
              dataSets.some(function(dataSet) {
                return dataSeriesList.some(function(dataSeries) {
                  if (dataSet.data_series_id === dataSeries.id) {
                    analysisObject.setDataSeries(dataSeries);
                    return true;
                  }
                });
              });

              analysis.AnalysisDataSeries.forEach(function(analysisDataSeries) {
                analysisObject.addAnalysisDataSeries(new DataModel.AnalysisDataSeries(analysisDataSeries.get()));
              });

              output.push(analysisObject);
            });

            resolve(output);
          }).catch(_reject);
        }).catch(_reject);
      }).catch(_reject);
    });
  },

  getAnalysis: function(restriction) {
    var self = this;
    return new Promise(function(resolve, reject) {
      var restrict = Object.assign({}, restriction || {});
      var dataSetRestriction = {};
      if (restrict && restrict.dataSet) {
        dataSetRestriction = restrict.dataSet;
        delete restrict.dataSet;
      }
      models.db.Analysis.findOne({
        where: restrict,
        include: [
          {
            model: models.db.AnalysisDataSeries,
            include: [
              {
                model: models.db.AnalysisDataSeriesMetadata,
                required: false
              }
            ]
          },
          {
            model: models.db.AnalysisOutputGrid,
            attributes: {include: [[orm.fn('ST_AsEwkt', orm.col('area_of_interest_box')), 'interest_box']]},
            required: false
          },
          models.db.AnalysisMetadata,
          models.db.ScriptLanguage,
          models.db.AnalysisType,
          models.db.Schedule,
          {
            model: models.db.DataSet,
            where: dataSetRestriction
          }
        ]
      }).then(function(analysisResult) {
        var analysisInstance = new DataModel.Analysis(analysisResult.get());

        self.getDataSet({id: analysisResult.dataset_output}).then(function(analysisOutputDataSet) {
          self.getDataSeries({id: analysisOutputDataSet.data_series_id}).then(function(analysisOutputDataSeries) {
            analysisInstance.setDataSeries(analysisOutputDataSeries);
            analysisResult.AnalysisDataSeries.forEach(function(analysisDataSeries) {
              var ds = Utils.find(self.data.dataSeries, {id: analysisDataSeries.data_series_id});
              var analysisDsMeta = new DataModel.AnalysisDataSeries(analysisDataSeries.get());
              analysisDsMeta.setDataSeries(ds);
              analysisInstance.addAnalysisDataSeries(analysisDsMeta);
            });

            resolve(analysisInstance);
          }).catch(function(err) {
            reject(err);
          });
        }).catch(function(err) {
          reject(err);
        });
      }).catch(function(err) {
        console.log(err);
        reject(new exceptions.AnalysisError("Could not retrieve Analysis " + err.message));
      });
    });
  },

  /**
   * It removes Analysis from param. It should be an object containing either id identifier or name identifier.
   *
   * @param {Object} analysisParam - An object containing Analysis identifier to get it.
   * @param {Boolean} cascade - A bool value to delete on cascade
   * @return {Promise} - a 'bluebird' module with Analysis instance or error callback
   */
  removeAnalysis: function(analysisParam, cascade) {
    var self = this;
    return new Promise(function(resolve, reject) {
      if(!cascade) { cascade = false; }

      self.getAnalysis({id: analysisParam.id}).then(function(analysisResult) {
        models.db.Analysis.destroy({where: {id: analysisParam.id}}).then(function() {
          self.removeDataSerie({id: analysisResult.dataSeries.id}).then(function() {
            self.removeSchedule({id: analysisResult.schedule.id}).then(function() {
              resolve();
            }).catch(function(err) {
              console.log("Could not remove analysis schedule ", err);
              reject(err);
            });
          }).catch(function(err) {
            console.log("Could not remove output data series ", err);
            reject(err);
          });
        }).catch(function(err) {
          console.log(err);
          reject(new exceptions.AnalysisError("Could not remove Analysis with a collector associated", err));
        });
      }).catch(function(err) {
        console.log(err);
        reject(err);
      });
    });
  }
};

module.exports = DataManager;
