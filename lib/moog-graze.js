/**
 * Created by stephen on 17/05/2016.
 */

// Export the options and the graze methods
// hide the auth, retry and proxy complexity
// Aim to provide a simple API based on the
// http://docs.moogsoft.com/display/MOOG/Graze+API
// remove need for auth_token paramter for each call
// pass a callback as the finnal parameter
//
// @example getAlertDetails(alert_id, callback(res, err) {});
// 
// Error conditions are returned in the err as a standard error 
// object, res is the response message from Moog as an object
//

/**
 * Module dependencies.
 */

var https = require('https');
var util = require('util');
var httpsProxy = require('https-proxy-agent');
var debug = require('debug')('graze');
var debugDetail = require('debug')('graze:verbose');

/**
 * Module exports.
 */

exports = module.exports = Graze;

exports.version = '0.2.1';


/**
 * Main module
 */

function Graze(grazeOpts)
{
  if (!(this instanceof Graze))
  {
    return new Graze(grazeOpts);
  }
  debug('creating new graze instance.');

  grazeOpts = grazeOpts || {};

  // Build the options object for the first time
  //
  this.connectOptions = {
    // return a default options object
    grazeUser         : "graze",
    grazePass         : "graze",
    grazeBasePath     : "/graze/v1",
    retry             : 3,
    hostname          : 'hostName',
    port              : 8080,
    rejectUnauthorized: false,
    caCert            : '',
    key               : '',
    cert              : '',
    useProxy          : false,
    proxyHost         : '',
    proxyPort         : 0,
    grazeHeaders      : {
      'accept'      : 'application/json',
      'content-type': 'application/json'
    },
    authToken         : '',
    retryCount        : 0
  };

  // Add in any paramters passed
  //
  this.setOps(grazeOpts);
}

/**
 *
 * @param opts
 * @returns {Promise}
 */
function authenticate(opts)
{

  return new Promise(function (resolve, reject)
  {
    debug('Enter authenticate promise');

    // From 6.1.0+ use basic auth rather than auth token
    if (opts.auth && opts.auth.length > 0) {
      debug('authenticate use basic auth:' + opts.auth);
      resolve({auth_token: 'Using Basic Auth'});
      return;
    }
    // We already have an auth_token lets try and use it
    //
    if (opts.authToken)
    {
      debug('authenticate reuse existing token:' + opts.authToken);
      console.log('WARNING: Authenticate with auth token deprecated in 6.1.0+ use basic auth instead');
      resolve({auth_token: opts.authToken});
      return;
    }

    var grazeAuthPath = opts.grazeBasePath +
      "/authenticate?username=" + opts.grazeUser + "&password=" + opts.grazePass;

    var grazeLoginOpts = {
      host              : opts.hostname,
      port              : parseInt(opts.port),
      path              : grazeAuthPath,
      method            : 'GET',
      headers           : opts.grazeHeaders,
      rejectUnauthorized: opts.rejectUnauthorized
    };

    callGrazeEndpoint(grazeLoginOpts).then(function (response)
    {
      debug("authenticate - callGrazeEndpoint response " + response);
      opts.retryCount = 0;
      resolve(response);
    }, function (error)
    {
      console.log("authenticate - callGrazeEndpoint error: ", error.statusCode);

      if (error.statusCode !== 503)
      {
        debug("authenticate rejecting with an http error");
        reject(error);
      }
      else if (opts.retryCount < opts.retry)
      {
        console.log("authenticate: Retry " + opts.retryCount++ + ' of ' + opts.retry);
        authenticate(opts).then(function (response)
        {
          console.log("authenticate: Success!", response);
          resolve(response);
        }, function (error)
        {
          console.error("authenticate: Failed!", error.statusCode);
          reject(error);
        });
      }
      else
      {
        console.log('Retry count exceded');
        reject(error);
      }
    });

  });
}

/**
 *
 * @param type
 * @param opts
 * @param grazePath
 * @param [byteLengthBody]
 * @returns {object}
 */
function buildOpts(type, opts, grazePath, byteLengthBody)
{
  debug('Entering buildOpts type:' + type);
  var retvar = {
    host              : opts.hostname,
    port              : parseInt(opts.port),
    path              : grazePath,
    method            : type,
    headers           : opts.grazeHeaders,
    rejectUnauthorized: opts.rejectUnauthorized
  };

  if (opts.auth && opts.auth.length > 0) {
    debug('buildOpts use Basic Auth');
    retvar.auth = opts.auth;
  }

  if (type === 'POST')
  {
    debug('buildOpts body length:' + byteLengthBody);
    retvar.headers['content-length'] = byteLengthBody;
    debug('buildOps headers:' + util.inspect(retvar.headers));
  } else
  {
    delete retvar.headers['content-length'];
  }

  return retvar;
}

/**
 *
 * @param opts
 * @param {object} [body] Only for POST
 * @returns {Promise}
 */
function callGrazeEndpoint(opts, body)
{

  return new Promise(function (resolve, reject)
  {


    if (opts.port === 0 || !opts.port)
    {
      debug('Enter callGrazeEndpoint promise: https://' + opts.host + "" + opts.path);
      delete opts.port;
    } else
    {
      debug('Enter callGrazeEndpoint promise: https://' + opts.host + ":" + opts.port + "" + opts.path);
    }

    // We use an agent so we can add a proxy if needed
    //
    if (!opts.agent)
    {
      debug('callGrazeEndpoint generating https agent');
      opts.agent = new https.Agent(opts);
    }
    debugDetail('callGrazeEndpoint opts: ' + util.inspect(opts));
    var req = https.request(opts, (res) =>
    {
      res.setEncoding('utf8');
      var resData = {};
      var returnString = "";

      debug('callGrazeEndpoint https.request: response statusCode: ' + res.statusCode);
      debugDetail('callGrazeEndpoint https.request: headers: ' + res.headers);

      res.on('data', function (d)
      {
        returnString += d;
        debugDetail("callGrazeEndpoint: on chunk returnString:" + returnString.toString('utf8'));
      });
      res.on('end', function ()
      {
        debug("callGrazeEndpoint: on end returnString: " + returnString.toString('utf8'));
        try
        {
          resData = JSON.parse(returnString.toString('utf8'));
        }
        catch (e)
        {
          debug("callGrazeEndpoint: Failed to parse returned JSON string: " + e);
          resData = {};
          resData.description = 'No Data returned';
        }

        if (res.statusCode === 200 && res.statusMessage === 'OK')
        {
          debug("callGrazeEndpoint received graze data " + res.statusCode + ': ' + res.statusMessage);
          resolve(resData);
        }
        else if (resData.message)
        {
          var moogStatusMessage = resData.statusMessage
          if (!moogStatusMessage && resData.additional && resData.additional.debugMessage) {
            moogStatusMessage = resData.additional.debugMessage;
          }
          console.log("callGrazeEndpoint: Failed to get graze data statusCode:" +
            res.statusCode + '  statusMessage: ' + res.statusMessage + ' MOOG message: ' + resData.statusCode + ':' +
            resData.message + " moog status message:" + moogStatusMessage);
          res.message = resData;
          reject(res);
        }
        else
        {
          console.log("callGrazeEndpoint: Failed " + res.statusCode + ': ' + res.statusMessage);
          reject(res);
        }
      });
    });

    // If it is a POST we want to send the JSON body

    req.on('error', function (err)
    {
      console.log("callGrazeEndpoint: Connection to graze failed: " + err);
      reject(err);
    });

    if (opts.method === 'POST' && body)
    {
      req.end(body);
    }
    else
    {
      req.end();
    }
  });
}

/**
 *
 * @returns {object}
 */
Graze.prototype.getOps = function ()
{
  debug('Entering getOps');
  debugDetail('getOps connectOptions: ' + util.inspect(this.connectOptions));

  return Object.assign({}, this.connectOptions);
};

/**
 *
 * @param {object} opts
 */
Graze.prototype.setOps = function (opts)
{
  debug('Entering setOps');
  var localOps = opts || {};
  var keysUpdated = 0;

  if (localOps && typeof localOps !== 'object')
  {
    console.log('setOps: Paramter passed is not an object ignoring.');
    localOps = {};
  }

  debugDetail('setOps connectOptions before update: ' + util.inspect(this.connectOptions));

  for (var option in localOps)
  {
    if (localOps.hasOwnProperty(option))
    {
      debug('setOps seting option ' + option + ' from:' + this.connectOptions[option] + ' to:' + localOps[option]);
      this.connectOptions[option] = localOps[option];
      keysUpdated++;
    }
  }
  debugDetail('setOps connectOptions after update: ' + util.inspect(this.connectOptions));

  return keysUpdated;
};


// We could probably make these calls more generic but my brain hurts
//

// Add a function for each endpoint (As of 6.0.0);
// Update to add basic auth (6.1.0)
//
// addAlertCustomInfo
// addAlertToSituation
// addCustomInfo (deprecated)
// addProcess
// addService
// addSigCorrelationInfo
// addSituationCustomInfo
// addThreadEntry
// assignAlert(user_id)
// assignAlert(username)
// assignAndAcknowledgeAlert(user_id)
// assignAndAcknowledgeAlert(username)
// assignAndAcknowledgeSituation(user_id)
// assignAndAcknowledgeSituation(username)
// assignSituation(user_id)
// assignSituation(username)
// closeAlert
// closeSituation
// createSituation
// createTeam (6.1.0)
// createThread
// createMaintenanceWindow
// createUser (6.1.0)
// deassignAlert
// deassignSituation
// deleteMaintenanceWindow
// getActiveSituationIds
// getAlertDetails
// getAlertIds
// getMaintenanceWindows
// getSituationAlertIds
// getSituationDescription
// getSituationDetails
// getSituationHosts
// getSituationIds
// getSituationProcesses
// getSituationServices
// getSystemStatus
// getSystemSummary
// getTeamSituationIds
// getThreadEntries
// getUserInfo(user_id)
// getUserInfo(username)
// getUserRoles(user_id)
// getUserRoles(username)
// getUserTeams(user_id)
// getUserTeams(username)
// mergeSituations
// removeAlertFromSituation
// resolveSituation
// setAlertAcknowledgeState
// setAlertSeverity
// setSituationAcknowledgeState
// setSituationDescription
// setSituationExternalSeverity [*Deprecated* 5.2.3]
// setSituationProcesses
// setSituationServices
// updateTeam (6.1.0)

/**
 *
 * @param {number} alertId
 * @param {object} customInfo
 * @param {function} callback
 */
Graze.prototype.addAlertCustomInfo = function (alertId, customInfo, callback)
{
  debug("Entering addAlertCustomInfo");
  var opts = this.connectOptions;
  var self = this;

  var _addAlertCustomInfo = function (alertId, customInfo)
  {
    debug('Entering _addAlertCustomInfo');
    debug('_addAlertCustomInfo authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/addAlertCustomInfo";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.alert_id = alertId;
      grazeBody.custom_info = customInfo;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_addAlertCustomInfo - callGrazeEndpoint response " + response.description);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_addAlertCustomInfo - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('addAlertCustomInfo authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _addAlertCustomInfo(alertId, customInfo).then(function (response)
    {
      debug("addAlertCustomInfo response from _addAlertCustomInfo:" + response.description);
      debug("addAlertCustomInfo _addAlertCustomInfo call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("addAlertCustomInfo _addAlertCustomInfo error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("addAlertCustomInfo authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param alertId
 * @param sitnId
 * @param callback
 */
Graze.prototype.addAlertToSituation = function (alertId, sitnId, callback)
{
  debug("Entering addAlertToSituation");
  var opts = this.connectOptions;
  var self = this;

  var _addAlertToSituation = function (alertId, sitnId)
  {
    debug('Entering _addAlertToSituation alert_id:' + alertId + ' sitn_id:' + sitnId);
    debug('_addAlertToSituation authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/addAlertToSituation";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.alert_id = alertId;
      grazeBody.sitn_id = sitnId;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_addAlertToSituation - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_addAlertToSituation - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('addAlertToSituation authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _addAlertToSituation(alertId, sitnId).then(function (response)
    {
      debug("addAlertToSituation response from _addAlertToSituation:" + response.description);
      debug("addAlertToSituation _addAlertToSituation call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("addAlertToSituation _addAlertToSituation error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("addAlertToSituation authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param name
 * @param description
 * @param callback
 */
Graze.prototype.addProcess = function (name, description, callback)
{
  debug("Entering addProcess");
  var opts = this.connectOptions;
  var self = this;

  var _addProcess = function (name, description)
  {
    debug('Entering _addProcess');
    debug('_addProcess authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/addProcess";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.name = name;
      grazeBody.description = description;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_addProcess - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_addProcess - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('addProcess authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _addProcess(name, description).then(function (response)
    {
      debug("addProcess response from _addProcess:" + response.description);
      debug("addProcess _addProcess call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("addProcess _addProcess error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("addProcess authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param name
 * @param description
 * @param callback
 */
Graze.prototype.addService = function (name, description, callback)
{
  debug("Entering addService");
  var opts = this.connectOptions;
  var self = this;

  var _addService = function (name, description)
  {
    debug('Entering _addService');
    debug('_addService authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/addService";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.name = name;
      grazeBody.description = description;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_addService - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_addService - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('addService authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _addService(name, description).then(function (response)
    {
      debug("addService response from _addService:" + response.description);
      debug("addService _addService call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("addService _addService error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("addService authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param sitnId
 * @param serviceName
 * @param resourceId
 * @param callback
 */
Graze.prototype.addSigCorrelationInfo = function (sitnId, serviceName, resourceId, callback)
{
  debug("Entering addSigCorrelationInfo");
  var opts = this.connectOptions;
  var self = this;

  var _addSigCorrelationInfo = function (sitnId, serviceName, resourceId)
  {
    debug('Entering _addSigCorrelationInfo sitn_id:' + sitnId +
      ' service_name:' + serviceName + ' resource_id:' + resourceId);
    debug('_addSigCorrelationInfo authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/addSigCorrelationInfo";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      grazeBody.service_name = serviceName;
      grazeBody.resource_id = resourceId;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_addSigCorrelationInfo - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_addSigCorrelationInfo - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('addSigCorrelationInfo authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _addSigCorrelationInfo(sitnId, serviceName, resourceId).then(function (response)
    {
      debug("addSigCorrelationInfo response from _addSigCorrelationInfo:" + response.description);
      debug("addSigCorrelationInfo _addSigCorrelationInfo call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("addSigCorrelationInfo _addSigCorrelationInfo error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("addSigCorrelationInfo authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param sitnId
 * @param customInfo
 * @param callback
 */
Graze.prototype.addSituationCustomInfo = function (sitnId, customInfo, callback)
{
  debug("Entering addSituationCustomInfo");
  var opts = this.connectOptions;
  var self = this;

  var _addSituationCustomInfo = function (sitnId, customInfo)
  {
    debug('Entering _addSituationCustomInfo sitn_id:' + sitnId);
    debug('_addSituationCustomInfo authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/addSituationCustomInfo";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      grazeBody.custom_info = customInfo;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_addSituationCustomInfo - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_addSituationCustomInfo - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('addSituationCustomInfo authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _addSituationCustomInfo(sitnId, customInfo).then(function (response)
    {
      debug("addSituationCustomInfo response from _addSituationCustomInfo:" + response.description);
      debug("addSituationCustomInfo _addSituationCustomInfo call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("addSituationCustomInfo _addSituationCustomInfo error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("addSituationCustomInfo authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param sitnId
 * @param threadName
 * @param entry
 * @param callback
 */
Graze.prototype.addThreadEntry = function (sitnId, threadName, entry, callback)
{
  debug("Entering addThreadEntry");
  var opts = this.connectOptions;
  var self = this;

  var _addThreadEntry = function (sitnId, threadName, entry)
  {
    debug('Entering _addThreadEntry sitn_id:' + sitnId);
    debug('_addThreadEntry authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/addThreadEntry";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      grazeBody.thread_name = threadName;
      grazeBody.entry = entry;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_addThreadEntry - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_addThreadEntry - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('addThreadEntry authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _addThreadEntry(sitnId, threadName, entry).then(function (response)
    {
      debug("addThreadEntry response from _addThreadEntry:" + response.description);
      debug("addThreadEntry _addThreadEntry call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("addThreadEntry _addThreadEntry error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("addThreadEntry authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} alertId
 * @param {number,string} user
 * @param {function} callback
 */
Graze.prototype.assignAlert = function (alertId, user, callback)
{
  debug("Entering assignAlert");
  var opts = this.connectOptions;
  var self = this;

  var _assignAlert = function (alertId, user)
  {
    debug('Entering _assignAlert');
    debug('_assignAlert authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/assignAlert";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.alert_id = alertId;
      if (typeof user === 'string')
      {
        grazeBody.username = user;
      } else if (typeof user === 'number')
      {
        grazeBody.user_id = user;
      } else
      {
        reject({statusCode: 400, statusMessage: 'parameter user ' + user + ' is unsupported type ' + typeof user});
      }

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_assignAlert - callGrazeEndpoint response " + response.description);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_assignAlert - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('assignAlert authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _assignAlert(alertId, user).then(function (response)
    {
      debug("assignAlert response from _assignAlert:" + response.description);
      debug("assignAlert _assignAlert call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("assignAlert _assignAlert error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("assignAlert authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} alertId
 * @param {number,string} user
 * @param {function} callback
 */
Graze.prototype.assignAndAcknowledgeAlert = function (alertId, user, callback)
{
  debug("Entering assignAndAcknowledgeAlert");
  var opts = this.connectOptions;
  var self = this;

  var _assignAndAcknowledgeAlert = function (alertId, user)
  {
    debug('Entering _assignAndAcknowledgeAlert');
    debug('_assignAndAcknowledgeAlert authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/assignAndAcknowledgeAlert";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.alert_id = alertId;
      if (typeof user === 'string')
      {
        grazeBody.username = user;
      } else if (typeof user === 'number')
      {
        grazeBody.user_id = user;
      } else
      {
        reject({statusCode: 400, statusMessage: 'parameter user ' + user + ' is unsupported type ' + typeof user});
      }

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_assignAndAcknowledgeAlert - callGrazeEndpoint response " + response.description);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_assignAndAcknowledgeAlert - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('assignAndAcknowledgeAlert authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _assignAndAcknowledgeAlert(alertId, user).then(function (response)
    {
      debug("assignAndAcknowledgeAlert response from _assignAndAcknowledgeAlert:" + response.description);
      debug("assignAndAcknowledgeAlert _assignAndAcknowledgeAlert call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("assignAndAcknowledgeAlert _assignAndAcknowledgeAlert error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("assignAndAcknowledgeAlert authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {number,string} user
 * @param {function} callback
 */
Graze.prototype.assignAndAcknowledgeSituation = function (sitnId, user, callback)
{
  debug("Entering assignAndAcknowledgeSituation");
  var opts = this.connectOptions;
  var self = this;

  var _assignAndAcknowledgeSituation = function (sitnId, user)
  {
    debug('Entering _assignAndAcknowledgeSituation');
    debug('_assignAndAcknowledgeSituation authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/assignAndAcknowledgeSituation";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      if (typeof user === 'string')
      {
        grazeBody.username = user;
      } else if (typeof user === 'number')
      {
        grazeBody.user_id = user;
      } else
      {
        reject({statusCode: 400, statusMessage: 'parameter user ' + user + ' is unsupported type ' + typeof user});
      }

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_assignAndAcknowledgeSituation - callGrazeEndpoint response " + response.description);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_assignAndAcknowledgeSituation - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('assignAndAcknowledgeSituation authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _assignAndAcknowledgeSituation(sitnId, user).then(function (response)
    {
      debug("assignAndAcknowledgeSituation response from _assignAndAcknowledgeSituation:" + response.description);
      debug("assignAndAcknowledgeSituation _assignAndAcknowledgeSituation call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("assignAndAcknowledgeSituation _assignAndAcknowledgeSituation error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("assignAndAcknowledgeSituation authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {number,string} user
 * @param {function} callback
 */
Graze.prototype.assignSituation = function (sitnId, user, callback)
{
  debug("Entering assignSituation");
  var opts = this.connectOptions;
  var self = this;

  var _assignSituation = function (sitnId, user)
  {
    debug('Entering _assignSituation');
    debug('_assignSituation authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/assignSituation";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      if (typeof user === 'string')
      {
        grazeBody.username = user;
      } else if (typeof user === 'number')
      {
        grazeBody.user_id = user;
      } else
      {
        reject({statusCode: 400, statusMessage: 'parameter user ' + user + ' is unsupported type ' + typeof user});
      }

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_assignSituation - callGrazeEndpoint response " + response.description);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_assignSituation - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('assignSituation authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _assignSituation(sitnId, user).then(function (response)
    {
      debug("assignSituation response from _assignSituation:" + response.description);
      debug("assignSituation _assignSituation call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("assignSituation _assignSituation error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("assignSituation authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} alertId
 * @param {function} callback
 */
Graze.prototype.closeAlert = function (alertId, callback)
{
  debug("Entering closeAlert");
  var opts = this.connectOptions;
  var self = this;

  var _closeAlert = function (alertId)
  {
    debug('Entering _closeAlert');
    debug('_closeAlert authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/closeAlert";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.alert_id = alertId;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_closeAlert - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_closeAlert - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('closeAlert authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _closeAlert(alertId).then(function (response)
    {
      debug("closeAlert response from _closeAlert:" + response.description);
      debug("closeAlert _closeAlert call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("closeAlert _closeAlert error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("closeAlert authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {string} resolution
 * @param {function} callback
 */
Graze.prototype.closeSituation = function (sitnId, resolution, callback)
{
  debug("Entering closeSituation");
  var opts = this.connectOptions;
  var self = this;

  var _closeSituation = function (sitnId, resolution)
  {
    debug('Entering _closeSituation sitn_id:' + sitnId);
    debug('_closeSituation authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/closeSituation";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      grazeBody.resolution = resolution;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_closeSituation - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_closeSituation - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('closeSituation authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _closeSituation(sitnId, resolution).then(function (response)
    {
      debug("closeSituation response from _closeSituation:" + response.description);
      debug("closeSituation _closeSituation call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("closeSituation _closeSituation error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("closeSituation authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {string} description
 * @param {function} callback
 */
Graze.prototype.createSituation = function (description, callback)
{
  debug("Entering createSituation");
  var opts = this.connectOptions;
  var self = this;

  var _createSituation = function (description)
  {
    debug('Entering _createSituation description:' + description);
    debug('_createSituation authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/createSituation";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.description = description;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_createSituation - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_createSituation - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('createSituation authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _createSituation(description).then(function (response)
    {
      debug("createSituation response from _createSituation:" + response.description);
      debug("createSituation _createSituation call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("createSituation _createSituation error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("createSituation authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {string} threadName
 * @param {function} callback
 */
Graze.prototype.createThread = function (sitnId, threadName, callback)
{
  debug("Entering createThread");
  var opts = this.connectOptions;
  var self = this;

  var _createThread = function (sitnId, threadName)
  {
    debug('Entering _createThread sitn_id:' + sitnId);
    debug('_createThread authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/createThread";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      grazeBody.thread_name = threadName;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_createThread - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_createThread - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('createThread authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _createThread(sitnId, threadName).then(function (response)
    {
      debug("createThread response from _createThread:" + response.description);
      debug("createThread _createThread call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("createThread _createThread error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("createThread authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 * This is a maintenance object constructor to be used in relation to this Graze implementation, it is not used in
 * the general Graze definition as seen in the Moogsoft documents and is used as a convenience and abstration here.
 *
 * @param {string} name - The name of the window
 * @param {string} description - Description of the window
 * @param {string} filter - JSON Object, filter for which alerts to match
 * @param {number} startDateTime - Epoch Seconds time to start the window from
 * @param {number} duration - Seconds duration of the window in seconds
 * @param {boolean} forwardAlerts - Do we forward the Alerts that are captured?
 * @param {number} recurringPeriod - How many days/weeks/months to wait before this recurs
 * @param {number} recurringPeriodUnits - Decides what the recurring period counts in
 *        0 = minutes, 1 = hours, 2 = days, 3 = weeks, 4 = months
 * @type {{}}
 */
Graze.prototype.maintObj = function () {
    this.name = '';
    this.description = '';
    this.filter = '{}';
    this.startDateTime = 0;
    this.duration = 0;
    this.forwardAlerts = false;
    this.recurringPeriod = 0;
    this.recurringPeriodUnits = 0;
  }

/**
 * @param {maintObj} maintObj - An instance of the maintenance object (see above prototype)
 * @param {function} callback
 */
Graze.prototype.createMaintenanceWindow = function (maintObj, callback)
{
  debug("Entering createMaintenanceWindow");
  var opts = this.connectOptions;
  var self = this;

  // TODO: Test the maintObj.filter to see if it's SQL and convert to Moog gobbledegook

  var _createMaintenanceWindow = function (maintObj)
  {
    debug('Entering _createMaintenanceWindow');
    debug('_createMaintenanceWindow authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/createMaintenanceWindow";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.name = maintObj.name;
      grazeBody.description = maintObj.description;
      grazeBody.filter = maintObj.filter;
      grazeBody.start_date_time = maintObj.startDateTime;
      grazeBody.duration = maintObj.duration;
      grazeBody.forward_alerts = maintObj.forwardAlerts;
      grazeBody.recurring_period = maintObj.recurringPeriod;
      grazeBody.recurring_period_units = maintObj.recurringPeriodUnits;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_createMaintenanceWindow - callGrazeEndpoint response " + response.description);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_createMaintenanceWindow - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('createMaintenanceWindow authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _createMaintenanceWindow(maintObj).then(function (response)
    {
      debug("createMaintenanceWindow response from _createMaintenanceWindow:" + response.description);
      debug("createMaintenanceWindow _createMaintenanceWindow call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("createMaintenanceWindow _createMaintenanceWindow error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("createMaintenanceWindow authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 * This is a team object constructor to be used in relation to this Graze implementation, it is not used in
 * the general Graze definition as seen in the Moogsoft documents and is used as a convenience and abstration here.
 *
 * @param {number} teamId - Only used for update, delete for create
 * @param {string} name - The new team (unique) name
 * @param {string} alertFilter - Either a SQL like filter or an JSON representation of the filter
 * @param {boolean} active	- False if the team is inactive, true if the team is active. Default to true
 * @param {string} services - JSON List of the team services names or IDs
 * @param {string} sigFilter - The situation filters. Either a SQL like filter or an JSON representation of the filter
 * @param {string} landingPage - The team default landing page
 * @param {string} description - The team description
 * @param {string} users	- List of numbers or strings	The team users (either IDs or usernames)
 *
 * @type {{}}
 */
Graze.prototype.teamObj = function () {
  this.teamId = 0;
  this.name = '';
  this.alertFilter = '';
  this.active = true;
  this.services = '[]';
  this.sigFilter = '';
  this.landingPage = '';
  this.description = '';
  this.users = '[]';
}

/**
 * @param {teamObj} teamObj - An instance of the team object (see above prototype)
 * @param {function} callback
 */
Graze.prototype.createTeam = function (teamObj, callback)
{
  debug("Entering createTeam");
  var opts = this.connectOptions;
  var self = this;

  var _createTeam = function (teamObj)
  {
    debug('Entering _createTeam');
    debug('_createTeam authToken: ' + opts.authToken);
    delete(teamObj.teamId);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/createTeam";

      var grazeBody = {};
      grazeBody.name = teamObj.name;
      grazeBody.alert_filter = teamObj.alertFilter;
      grazeBody.active = teamObj.active;
      grazeBody.services = teamObj.services;
      grazeBody.sig_filter = teamObj.sigFilter;
      grazeBody.landing_page = teamObj.landingPage;
      grazeBody.description = teamObj.description;
      grazeBody.users = teamObj.users;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_createTeam - callGrazeEndpoint response user_id " + response.user_id);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_createTeam - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('createTeam authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _createTeam(teamObj).then(function (response)
    {
      debug("createTeam response from _createTeam:" + response.description);
      debug("createTeam _createTeam call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("createTeam _createTeam error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("createTeam authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 * This is a user object constructor to be used in relation to this Graze implementation, it is not used in
 * the general Graze definition as seen in the Moogsoft documents and is used as a convenience and abstration here.
 *
 * @param {string} username - The new user (unique) login username
 * @param {string} password - The new user password (only valid for DB realm)
 * @param {boolean} active - true if the user active, false if the user inactive, default to true
 * @param {string} email - The user email address
 * @param {string} fullName - The user full name
 * @param {string} roles - List containg either the role IDs or role names. E.g "roles":["Super User"]
 * @param {string/number} primaryGroup	- The user primary group name or primary group id
 * @param {string/number} department - The user department id or name
 * @param {number} joined	- The time the user joined (epoch)
 * @param {string} timeZone - The user timezone
 * @param {string} contactNum - The user phone number
 * @param {number} sessionExpiry - The number of minutes after which the user session will expire. Or system default
 * @param {string} competencies - JSON list - A list with the user competencies.
 * Each competency should have have name or cid and ranking. That is, something like:
 * [
 * {"name":"SunOS", "ranking": 40},
 * {"name":"SAP", "ranking": 50},
 * {"name":"EMC", "ranking": 60}
 * ]
 * @param {string} teams - JSON list - List of the user teams.
 * The list should contains either the list of the teams ID or the teams name
 *
 * @type {{}}
 */
Graze.prototype.userObj = function () {
  this.username = '';
  this.password = '';
  this.active = true;
  this.email = '';
  this.fullName = '';
  this.roles = '[]'
  this.primaryGroup = '';
  this.department = 0;
  this.joined = 0;
  this.timezone = '';
  this.contactNum = '';
  this.sessionExpiry = 0;
  this.competencies = '[]';
  this.teams = '[]';
}

/**
* @param {userObj} userObj - An instance of the user object (see above prototype)
* @param {function} callback
*/
Graze.prototype.createUser = function (userObj, callback)
{
  debug("Entering createUser");
  var opts = this.connectOptions;
  var self = this;

  var _createUser = function (userObj)
  {
    debug('Entering _createUser');
    debug('_createUser authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/createUser";

      var grazeBody = {};
      grazeBody.username = userObj.username;
      grazeBody.password = userObj.password;
      grazeBody.active = userObj.active;
      grazeBody.email = userObj.email;
      grazeBody.full_name = userObj.fullName;
      grazeBody.roles = userObj.roles;
      grazeBody.primary_group = userObj.primaryGroup;
      grazeBody.department = userObj.department;
      grazeBody.joined = userObj.joined;
      grazeBody.timezone = userObj.timezone;
      grazeBody.contact_num = userObj.contactNum;
      grazeBody.session_expiry = userObj.sessionExpiry;
      grazeBody.competencies = userObj.competencies;
      grazeBody.teams = userObj.teams;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_createUser - callGrazeEndpoint response user_id " + response.user_id);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_createUser - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('createUser authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _createUser(userObj).then(function (response)
    {
      debug("createUser response from _createUser:" + response.description);
      debug("createUser _createUser call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("createUser _createUser error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("createUser authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} alertId
 * @param {function} callback
 */
Graze.prototype.deassignAlert = function (alertId, callback)
{
  debug("Entering deassignAlert");
  var opts = this.connectOptions;
  var self = this;

  var _deassignAlert = function (alertId)
  {
    debug('Entering _deassignAlert');
    debug('_deassignAlert authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/deassignAlert";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.alert_id = alertId;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_deassignAlert - callGrazeEndpoint response " + response.description);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_deassignAlert - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('deassignAlert authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _deassignAlert(alertId).then(function (response)
    {
      debug("deassignAlert response from _deassignAlert:" + response.description);
      debug("deassignAlert _deassignAlert call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("deassignAlert _deassignAlert error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("deassignAlert authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {function} callback
 */
Graze.prototype.deassignSituation = function (sitnId, callback)
{
  debug("Entering deassignSituation");
  var opts = this.connectOptions;
  var self = this;

  var _deassignSituation = function (sitnId)
  {
    debug('Entering _deassignSituation');
    debug('_deassignSituation authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {
      var grazePath = opts.grazeBasePath + "/deassignSituation";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_deassignSituation - callGrazeEndpoint response " + response.description);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_deassignSituation - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('deassignSituation authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _deassignSituation(sitnId).then(function (response)
    {
      debug("deassignSituation response from _deassignSituation:" + response.description);
      debug("deassignSituation _deassignSituation call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("deassignSituation _deassignSituation error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("deassignSituation authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} window - The window id to delete
 * @param {function} callback
 */
Graze.prototype.deleteMaintenanceWindow = function (window, callback)
{
  debug("Entering deleteMaintenanceWindow");
  var opts = this.connectOptions;
  var self = this;

  var _deleteMaintenanceWindow = function (window)
  {
    debug('Entering _deleteMaintenanceWindow');
    debug('_deleteMaintenanceWindow authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {
      var grazePath = opts.grazeBasePath + "/deleteMaintenanceWindow";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.id = window;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_deleteMaintenanceWindow - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_deleteMaintenanceWindow - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('deleteMaintenanceWindow authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _deleteMaintenanceWindow(window).then(function (response)
    {
      debug("deleteMaintenanceWindow response from _deleteMaintenanceWindow:" + response.description);
      debug("deleteMaintenanceWindow _deleteMaintenanceWindow call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("deleteMaintenanceWindow _deleteMaintenanceWindow error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("deleteMaintenanceWindow authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {string} filter - The query to filter maintnence windows to delete
 * @param {function} limit - The maximum number of windows to delete. (default 100)
 * @param {function} callback
 */
Graze.prototype.deleteMaintenanceWindows = function (filter, limit, callback)
{
  debug("Entering deleteMaintenanceWindows");
  var opts = this.connectOptions;
  var self = this;

  var _deleteMaintenanceWindows = function (filter, limit)
  {
    debug('Entering _deleteMaintenanceWindows');
    debug('_deleteMaintenanceWindows authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {
      var grazePath = opts.grazeBasePath + "/deleteMaintenanceWindows";

      var grazeBody = {};
      grazeBody.filter = encodeURIComponent(filter);
      grazeBody.limit = limit;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_deleteMaintenanceWindows - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_deleteMaintenanceWindows - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('deleteMaintenanceWindows authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _deleteMaintenanceWindows(filter, limit).then(function (response)
    {
      debug("deleteMaintenanceWindows response from _deleteMaintenanceWindow:" + response.description);
      debug("deleteMaintenanceWindows _deleteMaintenanceWindow call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("deleteMaintenanceWindows _deleteMaintenanceWindow error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("deleteMaintenanceWindows authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {string} filter - The query to filter maintnence windows
 * @param {function} limit - The maximum number of windows to return. (default 100)
 * @param {function} callback
 */
Graze.prototype.findMaintenanceWindows = function (filter, limit, callback)
{
  debug("Entering findMaintenanceWindows");
  var opts = this.connectOptions;
  var self = this;

  var _findMaintenanceWindows = function (filter, limit)
  {
    debug('Entering _findMaintenanceWindows');
    debug('_findMaintenanceWindows authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {
      var grazePath = opts.grazeBasePath + "/findMaintenanceWindows";

      var grazeBody = {};
      grazeBody.filter = encodeURIComponent(filter);
      grazeBody.limit = limit;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_findMaintenanceWindows - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_findMaintenanceWindows - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('findMaintenanceWindows authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _findMaintenanceWindows(filter, limit).then(function (response)
    {
      debug("findMaintenanceWindows response from _deleteMaintenanceWindow:" + response.description);
      debug("findMaintenanceWindows _deleteMaintenanceWindow call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("findMaintenanceWindows _deleteMaintenanceWindow error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("findMaintenanceWindows authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {function} callback
 */
Graze.prototype.getActiveSituationIds = function (callback)
{
  debug("Entering getActiveSituationIds");
  var opts = this.connectOptions;
  var self = this;

  var _getActiveSituationIds = function ()
  {
    debug('Entering _getActiveSituationIds');
    debug('_getActiveSituationIds authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getActiveSituationIds?auth_token=" + opts.authToken;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getActiveSituationIds - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getActiveSituationIds - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getActiveSituationIds authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getActiveSituationIds().then(function (response)
    {
      debug("getActiveSituationIds response from _getActiveSituationIds:" + response.description);
      debug("getActiveSituationIds _getActiveSituationIds call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getActiveSituationIds _getActiveSituationIds error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getActiveSituationIds authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });

};

/**
 *
 * @param {number} alertId
 * @param {function} callback
 */
Graze.prototype.getAlertDetails = function (alertId, callback)
{
  debug("Entering getAlertDetails");
  var opts = this.connectOptions;
  var self = this;

  var _getAlertDetails = function (alertId)
  {
    debug('Entering _getAlertDetails');
    debug('_getAlertDetails authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getAlertDetails?auth_token=" + opts.authToken + "&alert_id=" + alertId;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getAlertDetails - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getAlertDetails - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getAlertDetails authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getAlertDetails(alertId).then(function (response)
    {
      debug("getAlertDetails response from _getAlertDetails:" + response.description);
      debug("getAlertDetails _getAlertDetails call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getAlertDetails _getAlertDetails error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getAlertDetails authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });

};

/**
 *
 * @param {string} query - JSON Moogsoft query
 * @param {number} limit - Number of alert ids to return
 * @param {function} callback
 */
Graze.prototype.getAlertIds = function (query, limit, callback)
{
  debug("Entering getAlertIds");
  var opts = this.connectOptions;
  var self = this;

  var _getAlertIds = function (query, limit)
  {
    debug('Entering _getAlertIds');
    debug('_getAlertIds authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getAlertIds?auth_token=" + opts.authToken +
        "&query=" + encodeURIComponent(query) + "&limit=" + limit;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getAlertIds - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getAlertIds - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getAlertIds authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getAlertIds(query, limit).then(function (response)
    {
      debug("getAlertIds response from _getAlertIds:" + response.description);
      debug("getAlertIds _getAlertIds call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getAlertIds _getAlertIds error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getAlertIds authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} start - The id to start from
 * @param {number} limit - Number of windows to return
 * @param {function} callback
 */
Graze.prototype.getMaintenanceWindows = function (start, limit, callback)
{
  debug("Entering getMaintenanceWindows");
  var opts = this.connectOptions;
  var self = this;

  var _getMaintenanceWindows = function (start, limit)
  {
    debug('Entering _getMaintenanceWindows');
    debug('_getMaintenanceWindows authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getMaintenanceWindows?auth_token=" + opts.authToken +
        "&start=" + encodeURIComponent(start) + "&limit=" + limit;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getMaintenanceWindows - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getMaintenanceWindows - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getMaintenanceWindows authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getMaintenanceWindows(start, limit).then(function (response)
    {
      debug("getMaintenanceWindows response from _getMaintenanceWindows:" + response.description);
      debug("getMaintenanceWindows _getMaintenanceWindows call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getMaintenanceWindows _getMaintenanceWindows error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getMaintenanceWindows authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {function} callback
 */
Graze.prototype.getSystemStatus = function (callback)
{
  debug("Entering getSystemStatus");
  var opts = this.connectOptions;
  var self = this;

  var _getSystemStatus = function ()
  {
    debug('Entering _getSystemStatus');
    debug('_getSystemStatus authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getSystemStatus?auth_token=" + opts.authToken;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getSystemStatus - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getSystemStatus - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getSystemStatus authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getSystemStatus().then(function (response)
    {
      debug("getSystemStatus response from _getSystemStatus:" + response.description);
      debug("getSystemStatus _getSystemStatus call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getSystemStatus _getSystemStatus error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getSystemStatus authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });

};

/**
 *
 * @param {function} callback
 */
Graze.prototype.getSystemSummary = function (callback)
{
  debug("Entering getSystemSummary");
  var opts = this.connectOptions;
  var self = this;

  var _getSystemSummary = function ()
  {
    debug('Entering _getSystemSummary');
    debug('_getSystemSummary authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getSystemSummary?auth_token=" + opts.authToken;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getSystemSummary - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getSystemSummary - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getSystemSummary authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getSystemSummary().then(function (response)
    {
      debug("getSystemSummary response from _getSystemSummary:" + response.description);
      debug("getSystemSummary _getSystemSummary call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getSystemSummary _getSystemSummary error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getSystemSummary authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });

};

/**
 *
 * @param teamName
 * @param {function} callback
 */
Graze.prototype.getTeamSituationIds = function (teamName, callback)
{
  debug("Entering getTeamSituationIds");
  var opts = this.connectOptions;
  var self = this;

  var _getTeamSituationIds = function (teamName)
  {
    debug('Entering _getTeamSituationIds');
    debug('_getTeamSituationIds authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getTeamSituationIds?auth_token=" + opts.authToken +
        "&team_name=" + encodeURIComponent(teamName);

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getTeamSituationIds - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getTeamSituationIds - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getTeamSituationIds authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getTeamSituationIds(teamName).then(function (response)
    {
      debug("getTeamSituationIds response from _getTeamSituationIds:" + response.description);
      debug("getTeamSituationIds _getTeamSituationIds call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getTeamSituationIds _getTeamSituationIds error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getTeamSituationIds authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });

};

/**
 *
 * @param sitnId
 * @param threadName
 * @param {function} callback
 */
Graze.prototype.getThreadEntries = function (sitnId, threadName, callback)
{
  debug("Entering getThreadEntries");
  var opts = this.connectOptions;
  var self = this;

  var _getThreadEntries = function (sitnId, threadName)
  {
    debug('Entering _getThreadEntries');
    debug('_getThreadEntries authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getThreadEntries?auth_token=" + opts.authToken +
        "&sitn_id=" + sitnId +
        "&thread_name=" + threadName;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getThreadEntries - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getThreadEntries - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getThreadEntries authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getThreadEntries(sitnId, threadName).then(function (response)
    {
      debug("getThreadEntries response from _getThreadEntries:" + response.description);
      debug("getThreadEntries _getThreadEntries call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getThreadEntries _getThreadEntries error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getThreadEntries authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });

};

/**
 *
 * @param {string|number} user
 * @param {function} callback
 */
Graze.prototype.getUserInfo = function (user, callback)
{
  debug("Entering getUserInfo");
  var opts = this.connectOptions;
  var self = this;

  var _getUserInfo = function (user)
  {
    debug('Entering _getUserInfo');
    debug('_getUserInfo authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getUserInfo?auth_token=" + opts.authToken +
        "&user_id=" + user;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getUserInfo - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getUserInfo - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getUserInfo authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getUserInfo(user).then(function (response)
    {
      debug("getUserInfo response from _getUserInfo:" + response.description);
      debug("getUserInfo _getUserInfo call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getUserInfo _getUserInfo error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getUserInfo authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });

};

/**
 *
 * @param {string|number} user
 * @param {function} callback
 */
Graze.prototype.getUserRoles = function (user, callback)
{
  debug("Entering getUserRoles");
  var opts = this.connectOptions;
  var self = this;

  var _getUserRoles = function (user)
  {
    debug('Entering _getUserRoles');
    debug('_getUserRoles authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getUserRoles?auth_token=" + opts.authToken;

      if (typeof user === 'number')
      {
        grazePath += "&user_id=" + user;
      } else
      {
        grazePath += "&username=" + user;
      }

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getUserRoles - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getUserRoles - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getUserRoles authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getUserRoles(user).then(function (response)
    {
      debug("getUserRoles response from _getUserRoles:" + response.description);
      debug("getUserRoles _getUserRoles call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getUserRoles _getUserRoles error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getUserRoles authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });

};

/**
 *
 * @param {string|number} user
 * @param {function} callback
 */
Graze.prototype.getUserTeams = function (user, callback)
{
  debug("Entering getUserTeams");
  var opts = this.connectOptions;
  var self = this;

  var _getUserTeams = function (user)
  {
    debug('Entering _getUserTeams');
    debug('_getUserTeams authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getUserTeams?auth_token=" + opts.authToken;

      if (typeof user === 'number')
      {
        grazePath += "&user_id=" + user;
      } else
      {
        grazePath += "&username=" + user;
      }

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getUserTeams - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getUserTeams - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getUserTeams authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getUserTeams(user).then(function (response)
    {
      debug("getUserTeams response from _getUserTeams:" + response.description);
      debug("getUserTeams _getUserTeams call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getUserTeams _getUserTeams error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getUserTeams authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });

};

/**
 *
 * @param {number} sitnId
 * @param {boolean} uniqueOnly
 * @param {function} callback
 */
Graze.prototype.getSituationAlertIds = function (sitnId, uniqueOnly, callback)
{
  debug("Entering getSituationAlertIds");
  var opts = this.connectOptions;
  var self = this;
  var unique = (uniqueOnly == true);

  var _getSituationAlertIds = function (sitnId, unique)
  {
    debug('Entering _getSituationAlertIds');
    debug('_getSituationAlertIds authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getSituationAlertIds?auth_token=" + opts.authToken +
        "&sitn_id=" + sitnId + "&for_unique_alerts=" + unique;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getSituationAlertIds - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getSituationAlertIds - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getSituationAlertIds authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getSituationAlertIds(sitnId, unique).then(function (response)
    {
      debug("getSituationAlertIds response from _getSituationAlertIds:" + response.description);
      debug("getSituationAlertIds _getSituationAlertIds call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getSituationAlertIds _getSituationAlertIds error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getSituationAlertIds authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {function} callback
 */
Graze.prototype.getSituationDescription = function (sitnId, callback)
{
  debug("Entering getSituationDescription");
  var opts = this.connectOptions;
  var self = this;

  var _getSituationDescription = function (sitnId)
  {
    debug('Entering _getSituationDescription');
    debug('_getSituationDescription authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getSituationDescription?auth_token=" + opts.authToken +
        "&sitn_id=" + sitnId;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getSituationDescription - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getSituationDescription - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getSituationDescription authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getSituationDescription(sitnId).then(function (response)
    {
      debug("getSituationDescription response from _getSituationDescription:" + response.description);
      debug("getSituationDescription _getSituationDescription call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getSituationDescription _getSituationDescription error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getSituationDescription authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {function} callback
 */
Graze.prototype.getSituationDetails = function (sitnId, callback)
{
  debug("Entering getSituationDetails");
  var opts = this.connectOptions;
  var self = this;

  var _getSituationDetails = function (sitnId)
  {
    debug('Entering _getSituationDetails');
    debug('_getSituationDetails authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getSituationDetails?auth_token=" + opts.authToken +
        "&sitn_id=" + sitnId;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getSituationDetails - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getSituationDetails - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getSituationDetails authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getSituationDetails(sitnId).then(function (response)
    {
      debug("getSituationDetails response from _getSituationDetails:" + response.description);
      debug("getSituationDetails _getSituationDetails call callback with 200");
      callback(200, response);
    }, function (error)
    {
      console.log("getSituationDetails _getSituationDetails error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getSituationDetails authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {boolean} uniqueOnly
 * @param {function} callback
 */
Graze.prototype.getSituationHosts = function (sitnId, uniqueOnly, callback)
{
  debug("Entering getSituationHosts");
  var opts = this.connectOptions;
  var self = this;
  var unique = (uniqueOnly == true);

  var _getSituationHosts = function (sitnId, unique)
  {
    debug('Entering _getSituationHosts');
    debug('_getSituationHosts authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getSituationHosts?auth_token=" + opts.authToken +
        "&sitn_id=" + sitnId + "&for_unique_alerts=" + unique;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getSituationHosts - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getSituationHosts - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getSituationHosts authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getSituationHosts(sitnId, unique).then(function (response)
    {
      debug("getSituationHosts response from _getSituationHosts:" + response.description);
      debug("getSituationHosts _getSituationHosts call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getSituationHosts _getSituationHosts error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getSituationHosts authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {string} query - JSON Moogsoft query
 * @param {number} limit - Number of stuation ids to return
 * @param {function} callback
 */
Graze.prototype.getSituationIds = function (query, limit, callback)
{
  debug("Entering getSituationIds");
  var opts = this.connectOptions;
  var self = this;

  var _getSituationIds = function (query, limit)
  {
    debug('Entering _getSituationIds');
    debug('_getSituationIds authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {
      var grazePath = opts.grazeBasePath +
        "/getSituationIds?auth_token=" + opts.authToken +
        "&query=" + encodeURIComponent(query) + "&limit=" + limit;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getSituationIds - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getSituationIds - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getSituationIds authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getSituationIds(query, limit).then(function (response)
    {
      debug("getSituationIds response from _getSituationIds:" + response.description);
      debug("getSituationIds _getSituationIds call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getSituationIds _getSituationIds error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getSituationIds authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {function} callback
 */
Graze.prototype.getSituationProcesses = function (sitnId, callback)
{
  debug("Entering getSituationProcesses");
  var opts = this.connectOptions;
  var self = this;

  var _getSituationProcesses = function (sitnId)
  {
    debug('Entering _getSituationProcesses');
    debug('_getSituationProcesses authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getSituationProcesses?auth_token=" + opts.authToken +
        "&sitn_id=" + sitnId;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getSituationProcesses - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getSituationProcesses - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getSituationProcesses authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getSituationProcesses(sitnId).then(function (response)
    {
      debug("getSituationProcesses response from _getSituationProcesses:" + response.description);
      debug("getSituationProcesses _getSituationProcesses call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getSituationProcesses _getSituationProcesses error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getSituationProcesses authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {function} callback
 */
Graze.prototype.getSituationServices = function (sitnId, callback)
{
  debug("Entering getSituationServices");
  var opts = this.connectOptions;
  var self = this;

  var _getSituationServices = function (sitnId)
  {
    debug('Entering _getSituationServices');
    debug('_getSituationServices authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath +
        "/getSituationServices?auth_token=" + opts.authToken +
        "&sitn_id=" + sitnId;

      var grazeLoginOpts = buildOpts('GET', opts, grazePath);

      callGrazeEndpoint(grazeLoginOpts).then(function (response)
      {
        debug("_getSituationServices - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_getSituationServices - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('getSituationServices authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _getSituationServices(sitnId).then(function (response)
    {
      debug("getSituationServices response from _getSituationServices:" + response.description);
      debug("getSituationServices _getSituationServices call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("getSituationServices _getSituationServices error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("getSituationServices authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {Array} situations
 * @param {Boolean} [supersedeOriginal]
 * @param callback
 */
Graze.prototype.mergeSituations = function (situations, supersedeOriginal, callback)
{
  debug("Entering mergeSituations");
  var opts = this.connectOptions;
  var self = this;

  if (typeof supersedeOriginal === 'function' && !callback)
  {
    callback = supersedeOriginal;
    supersedeOriginal = false;
  }

  var _mergeSituations = function (situations, supersedeOriginal)
  {
    debug('Entering _mergeSituations situations:' + situations +
      ' supersede_original:' + supersedeOriginal);
    debug('_mergeSituations authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/mergeSituations";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      //grazeBody.situations = situations;
      //grazeBody.supersede_original = supersedeOriginal;

      // BUG MOOG-5040, should not have to stringify
      grazeBody.situations = JSON.stringify(situations);
      grazeBody.supersede_original = String(supersedeOriginal);

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_mergeSituations body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_mergeSituations - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_mergeSituations - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('mergeSituations authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _mergeSituations(situations, supersedeOriginal).then(function (response)
    {
      debug("mergeSituations response from _mergeSituations:" + response.description);
      debug("mergeSituations _mergeSituations call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("mergeSituations _mergeSituations error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("mergeSituations authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param alertId
 * @param sitnId
 * @param callback
 */
Graze.prototype.removeAlertFromSituation = function (alertId, sitnId, callback)
{
  debug("Entering removeAlertFromSituation");
  var opts = this.connectOptions;
  var self = this;

  var _removeAlertFromSituation = function (alertId, sitnId)
  {
    debug('Entering _removeAlertFromSituation situation:' + sitnId +
      ' alert:' + alertId);
    debug('_removeAlertFromSituation authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/removeAlertFromSituation";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.alert_id = alertId;
      grazeBody.sitn_id = sitnId;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_removeAlertFromSituation body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_removeAlertFromSituation - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_removeAlertFromSituation - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('removeAlertFromSituation authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _removeAlertFromSituation(alertId, sitnId).then(function (response)
    {
      debug("removeAlertFromSituation response from _removeAlertFromSituation:" + response.description);
      debug("removeAlertFromSituation _removeAlertFromSituation call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("removeAlertFromSituation _removeAlertFromSituation error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("removeAlertFromSituation authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param callback
 */
Graze.prototype.resolveSituation = function (sitnId, callback)
{
  debug("Entering resolveSituation");
  var opts = this.connectOptions;
  var self = this;

  var _resolveSituation = function (sitnId)
  {
    debug('Entering _resolveSituation situation:' + sitnId);
    debug('_resolveSituation authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/resolveSituation";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_resolveSituation body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_resolveSituation - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_resolveSituation - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('resolveSituation authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _resolveSituation(sitnId).then(function (response)
    {
      debug("resolveSituation response from _resolveSituation:" + response.description);
      debug("resolveSituation _resolveSituation call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("resolveSituation _resolveSituation error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("resolveSituation authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} alertId
 * @param {number} acknowledged - 0 for un-acknowledged, 1 for acknowledged
 * @param {function} callback
 */
Graze.prototype.setAlertAcknowledgeState = function (alertId, acknowledged, callback)
{
  debug("Entering setAlertAcknowledgeState");
  var opts = this.connectOptions;
  var self = this;

  var _setAlertAcknowledgeState = function (alertId, acknowledged)
  {
    debug('Entering _setAlertAcknowledgeState alert:' + alertId +
      ' acknowledged:' + acknowledged);
    debug('_setAlertAcknowledgeState authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/setAlertAcknowledgeState";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.alert_id = alertId;
      grazeBody.acknowledged = acknowledged;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_setAlertAcknowledgeState body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_setAlertAcknowledgeState - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_setAlertAcknowledgeState - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('setAlertAcknowledgeState authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _setAlertAcknowledgeState(alertId, acknowledged).then(function (response)
    {
      debug("setAlertAcknowledgeState response from _setAlertAcknowledgeState:" + response.description);
      debug("setAlertAcknowledgeState _setAlertAcknowledgeState call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("setAlertAcknowledgeState _setAlertAcknowledgeState error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("setAlertAcknowledgeState authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param alertId
 * @param {number} severity
 * @param callback
 */
Graze.prototype.setAlertSeverity = function (alertId, severity, callback)
{
  debug("Entering setAlertSeverity");
  var opts = this.connectOptions;
  var self = this;


  var _setAlertSeverity = function (alertId, severity)
  {
    debug('Entering _setAlertSeverity alert:' + alertId +
      ' severity:' + severity);
    debug('_setAlertSeverity authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/setAlertSeverity";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.alert_id = alertId;
      grazeBody.severity = severity;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_setAlertSeverity body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_setAlertSeverity - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_setAlertSeverity - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('setAlertSeverity authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _setAlertSeverity(alertId, severity).then(function (response)
    {
      debug("setAlertSeverity response from _setAlertSeverity:" + response.description);
      debug("setAlertSeverity _setAlertSeverity call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("setAlertSeverity _setAlertSeverity error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("setAlertSeverity authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param {number} sitnId
 * @param {string} acknowledged - 0 for un-acknowledged, 1 for acknowledged
 * @param callback
 */
Graze.prototype.setSituationAcknowledgeState = function (sitnId, acknowledged, callback)
{
  debug("Entering setSituationAcknowledgeState");
  var opts = this.connectOptions;
  var self = this;

  var _setSituationAcknowledgeState = function (sitnId, acknowledged)
  {
    debug('Entering _setSituationAcknowledgeState situation:' + sitnId +
      ' acknowledged:' + acknowledged);
    debug('_setSituationAcknowledgeState authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/setSituationAcknowledgeState";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      grazeBody.acknowledged = acknowledged;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_setSituationAcknowledgeState body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_setSituationAcknowledgeState - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_setSituationAcknowledgeState - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('setSituationAcknowledgeState authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _setSituationAcknowledgeState(sitnId, acknowledged).then(function (response)
    {
      debug("setSituationAcknowledgeState response from _setSituationAcknowledgeState:" + response.description);
      debug("setSituationAcknowledgeState _setSituationAcknowledgeState call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("setSituationAcknowledgeState _setSituationAcknowledgeState error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("setSituationAcknowledgeState authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param sitnId
 * @param {string} description
 * @param callback
 */
Graze.prototype.setSituationDescription = function (sitnId, description, callback)
{
  debug("Entering setSituationDescription");
  var opts = this.connectOptions;
  var self = this;

  var _setSituationDescription = function (sitnId, description)
  {
    debug('Entering _setSituationDescription situation:' + sitnId +
      ' description:' + description);
    debug('_setSituationDescription authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/setSituationDescription";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      grazeBody.description = description;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_setSituationDescription body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_setSituationDescription - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_setSituationDescription - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('setSituationDescription authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _setSituationDescription(sitnId, description).then(function (response)
    {
      debug("setSituationDescription response from _setSituationDescription:" + response.description);
      debug("setSituationDescription _setSituationDescription call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("setSituationDescription _setSituationDescription error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("setSituationDescription authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 * DEPRECATED 5.2.3
 * @param sitnId
 * @param {number} severity
 * @param callback
 */
Graze.prototype.setSituationExternalSeverity = function (sitnId, severity, callback)
{
  debug("Entering setSituationExternalSeverity **WARNING** Deprecated 5.2.3+");
  var opts = this.connectOptions;
  var self = this;

  var _setSituationExternalSeverity = function (sitnId, severity)
  {
    debug('Entering _setSituationExternalSeverity situation:' + sitnId +
      ' severity:' + severity);
    debug('_setSituationExternalSeverity authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/setSituationExternalSeverity";

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;
      grazeBody.severity = severity;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_setSituationExternalSeverity body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_setSituationExternalSeverity - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_setSituationExternalSeverity - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('setSituationExternalSeverity authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _setSituationExternalSeverity(sitnId, severity).then(function (response)
    {
      debug("setSituationExternalSeverity response from _setSituationExternalSeverity:" + response.description);
      debug("setSituationExternalSeverity _setSituationExternalSeverity call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("setSituationExternalSeverity _setSituationExternalSeverity error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("setSituationExternalSeverity authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param sitnId
 * @param {Array|string} processList
 * @param {string} [primaryProcess]
 * @param callback
 */
Graze.prototype.setSituationProcesses = function (sitnId, processList, primaryProcess, callback)
{
  debug("Entering setSituationProcesses");
  var opts = this.connectOptions;
  var self = this;

  if (typeof primaryProcess === 'function' && !callback)
  {
    callback = primaryProcess;
    primaryProcess = '';
  }

  var _setSituationProcesses = function (sitnId, processList, primaryProcess)
  {
    debug('Entering _setSituationProcesses sitn_id:' + sitnId +
      ' process_list:' + processList + ' [optional primary_process:' + primaryProcess + ']');
    debug('_setSituationProcesses authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/setSituationProcesses";

      if (typeof processList === 'string')
      {
        processList = [processList];
      }

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;

      // BUG MOOG-5019, should not have to stringify
      grazeBody.process_list = JSON.stringify(processList);
      if (primaryProcess)
      {
        grazeBody.primary_process = primaryProcess;
      }

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_setSituationProcesess body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_setSituationProcesses - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_setSituationProcesses - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('setSituationProcesses authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _setSituationProcesses(sitnId, processList, primaryProcess).then(function (response)
    {
      debug("setSituationProcesses response from _setSituationProcesses:" + response.description);
      debug("setSituationProcesses _setSituationProcesses call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("setSituationProcesses _setSituationProcesses error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("setSituationProcesses authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 *
 * @param sitnId
 * @param {Array|string} serviceList
 * @param {string} [primaryService]
 * @param callback
 */
Graze.prototype.setSituationServices = function (sitnId, serviceList, primaryService, callback)
{
  debug("Entering setSituationServices");
  var opts = this.connectOptions;
  var self = this;

  if (typeof primaryService === 'function' && !callback)
  {
    callback = primaryService;
    primaryService = '';
  }

  var _setSituationServices = function (sitnId, serviceList, primaryService)
  {
    debug('Entering _setSituationServices sitn_id:' + sitnId +
      ' process_list:' + serviceList + ' [optional primary_process:' + primaryService + ']');
    debug('_setSituationServices authToken: ' + opts.authToken);
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/setSituationServices";

      if (typeof serviceList === 'string')
      {
        serviceList = [serviceList];
      }

      var grazeBody = {};
      grazeBody.auth_token = opts.authToken;
      grazeBody.sitn_id = sitnId;

      // BUG MOOG-5019, should not have to stringify
      grazeBody.service_list = JSON.stringify(serviceList);
      if (primaryService)
      {
        grazeBody.primary_service = primaryService;
      }

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      debug('_setSituationServices body:' + body);

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_setSituationServices - callGrazeEndpoint response " + response);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_setSituationServices - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('setSituationServices authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _setSituationServices(sitnId, serviceList, primaryService).then(function (response)
    {
      debug("setSituationServices response from _setSituationServices:" + response.description);
      debug("setSituationServices _setSituationServices call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("setSituationServices _setSituationServices error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("setSituationServices authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};

/**
 * @param {teamObj} teamObj - An instance of the team object (see above prototype)
 * @param {function} callback
 */
Graze.prototype.updateTeam = function (teamObj, callback)
{
  debug("Entering updateTeam");
  var opts = this.connectOptions;
  var self = this;

  var _updateTeam = function (teamObj)
  {
    debug('Entering _updateTeam');
    return new Promise(function (resolve, reject)
    {

      var grazePath = opts.grazeBasePath + "/updateTeam";

      var grazeBody = {};
      grazeBody.team_id = teamObj.teamId;
      grazeBody.name = teamObj.name;
      grazeBody.alert_filter = teamObj.alertFilter;
      grazeBody.active = teamObj.active;
      grazeBody.services = teamObj.services;
      grazeBody.sig_filter = teamObj.sigFilter;
      grazeBody.landing_page = teamObj.landingPage;
      grazeBody.description = teamObj.description;
      grazeBody.users = teamObj.users;

      try
      {
        var body = JSON.stringify(grazeBody);
      }
      catch (e)
      {
        reject({statusCode: 400, statusMessage: e});
        return;
      }

      var grazeLoginOpts = buildOpts('POST', opts, grazePath, Buffer.byteLength(body));

      callGrazeEndpoint(grazeLoginOpts, body).then(function (response)
      {
        debug("_updateTeam - callGrazeEndpoint response user_id " + response.user_id);
        opts.retryCount = 0;
        resolve(response);
      }, function (error)
      {
        console.log("_updateTeam - callGrazeEndpoint error " + error.statusCode);
        reject(error);
      });
    });
  };

  authenticate(opts).then(function (response)
  {
    debug('updateTeam authenticate response authToken:' + response.auth_token);
    opts.authToken = response.auth_token;
    _updateTeam(teamObj).then(function (response)
    {
      debug("updateTeam response from updateTeam:" + response.description);
      debug("updateTeam _updateTeam call callback with OK");
      callback(200, response);
    }, function (error)
    {
      console.log("updateTeam _updateTeam error: " + error.statusCode);
      callback(error.statusCode, error.statusMessage);
    })
  }, function (error)
  {
    console.log("updateTeam authenticate error: " + error.statusCode + ' ' + error.statusMessage);
    self.authToken = '';
    callback(error.statusCode, error.statusMessage);
  });
};
