/*!
 * solar-sis
 * solar serial inverter system
 * Copyright(c) 2017 Erik Johansson, Daniel Römer
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

var express = require('express')
var app = express()
var request = require('request');
const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');
var fs = require('fs');
var log = require('npmdatelog');
var CRC16 = require('crc16');

log.enableDate('YYYY-MM-DD HH:mm:ss');

// mqtt stuff
var mqtt = require('mqtt');
//var client = mqtt.connect('mqtt://localhost');

var calls = JSON.parse(fs.readFileSync(process.argv[2] ? process.argv[2] : 'calls.json', "utf8"));
var session = JSON.parse(fs.readFileSync(process.argv[3] ? process.argv[3] : 'session.json', "utf8"));

/**
 * Module exports.
 * @public
 */

module.exports.mpi = mpi;
module.exports.calls = calls;
module.exports.session = session;
module.exports.SendDataToInflux = SendDataToInflux;
module.exports.cache = cache;

/**
 * A object to be added to the CommandQueue for scheduled to be sent to the converter on serialport
 * @class
 * @param  {string} name The name of the queue command
 */
function QueueCommand(name) {
	this.name = name;
	this.cmd = [];
	this.timestamp = Date.now();
	this.last = Date.now();
	this.callback;
	this.recived = false;
	this.interval = 0;
	this.times = 0;
	this.max = 0;
	this.req;
	this.res;
	this.isSetCommand = true;

	/**
	 * Add a command to this queue command
	 * @function
	 * @param  {string} cmd The command to add
	 */
	this.addCommand = function (cmd) {
		if (cmd.slice != undefined) {
			for (var i = 0; i < cmd.length; i += 8) {
				this.cmd.push(Buffer.from(cmd.slice(i, i + 8), 'ascii'));
			}
		}
	}
}

/**
 * A object to handle command and log commands to be sent to converter on serialport
 * @class
 */
function CommandQueue() {
	this.commands = [];
	this.logs = [];
	this.commandHistory = [];

	/**
	 * Add a new command to queue
	 * @function
	 * @param  {QueueCommand} qcmd Command to add to queue
	 */
	this.addCommand = function (qcmd) {
		if (qcmd != undefined) {
			this.commands.push(qcmd);
		}
	}

	/**
	 * Add a new log command to queue
	 * @function
	 * @param  {QueueCommand} qcmd Log command to add to queue
	 */
	this.addLogCommand = function (qcmd) {
		if (qcmd != undefined) {
			this.logs.push(qcmd);
		}
	}

	/**
	 * Get the next command in the command queue
	 * @function
	 * @returns {QueueCommand}
	 */
	this.getNextCommand = function () {
		var cmd = this.commands.shift();
		this.commandHistory[cmd.name] = cmd;
		return cmd;
	}

	/**
	 * Reuse a already added command
	 * @function
	 * @param  {string} name The name of the command to resurrect
	 * @returns {QueueCommand} Reused command
	 */
	this.resurrectCommand = function (name) {
		var cmd = this.commandHistory[name];
		if (cmd != undefined) {
			cmd.recived = false;
			cmd.req = undefined;
			cmd.res = undefined;
			cmd.times = 0;
		}
		return cmd;
	}
	
	/**
	 * Get next log command
	 * @function
	 * @returns {QueueCommand} The next log command
	 */
	this.getNextLog = function () {
		var index = this.logs.findIndex((element, i, array) => {
			return (Date.now() - element.last >= element.interval) ? true : false;
		});

		return this.getLogCommand(index);
	}

	/**
	 * Get log command from index in queue
	 * @function
	 * @param  {int} index Index of command to get
	 * @returns {QueueCommand}
	 */
	this.getLogCommand = function (index) {

		if (this.logs.length < 1 || index < 0) return undefined;

		return (this.logs[index].max == 0 || this.logs[index].times < this.logs[index].max) ?
			this.logs[index] :
			this.removeLogCommand(index);
	}

	/**
	 * Removed log command from queue from index
	 * @function
	 * @param  {int} index Index of command to remove
	 */
	this.removeLogCommand = function (index) {
		return this.logs.splice(index, 1)[0];
	}

	/**
	 * Get the total number of commands in log and action queue
	 * @function
	 * @returns {int} The number of commands
	 */
	this.count = function () {
		return this.commands.length + this.logs.length;
	}

	this.clearCommandQueue = function () {
		this.commands = [];
	}
}

/**
 * Create a influx accepted string from current string
 * @function
 */

function ToInfluxString(mergedDataArray) {
	var s = "";

	Object.keys(mergedDataArray).forEach((key) => {
		s += key + "=" + mergedDataArray[key] + ",";
	});

	return s.slice(0, -1);
}

/**
 * Merge json defined protocol return object and return data array
 * @function
 * @param  {object} json A json object to merge the array values into
 * @param  {object} queryValues Data array of matched json protocol definitions
 * @returns {object} A merged json object
 */

function MergeDataArray (json, queryValues) {
	var c = 0;
	var tempValues = {};
	var s = JSON.parse(JSON.stringify(json), (key, value) => {
		//console.log("key: " + key + " value: " + value);
		if (typeof value === 'number') value = queryValues[c] / ((value != 0) ? value : 1);
		else if (typeof value === 'boolean') value = (value) ? queryValues[c] : undefined;
		else if (value instanceof Array) {
			//console.log(JSON.stringify(value));
			//console.log(tempValues[value[0]] + " " + value[1] + " " + value[2] + " " + value[3]);
			if(value.length == 4 && tempValues[value[0]] && tempValues[value[0]].toString().length == Number(value[1])) {
				value = tempValues[value[0]].toString().substring(Number(value[2]), Number(value[3]));
			} else {
				value = undefined;
			}
		} else if (!Number.isNaN(Number(value))) value = Number(value);
		c++;
		tempValues[key] = value;
		return value;
	});

	return s;
}

/**
 * Calculate a crc16 on a string
 * @function
 * @param  {string} str String to calculate a crc16 on
 * @returns {string} The crc16 as a string
 */

function GetCrc16 (str) {
  var crc = "";
  Buffer.from(CRC16(str).toString(16), 'hex').forEach((b) => {
    if (b==10 || b==13 || b==40) {
        b++;
    }
    crc += String.fromCharCode(b);
  });
	return crc;
}

/**
 * Remove protocol specifications header from response string
 * @function
 * @param {object} commandConfig Object that contains protocol config object
 * @param {string} str String to remove remove protocol headers from
 * @returns {string} A header cleaned string
 */

function ResponseRemoveHeader(commandConfig, str) {
	var startIndex = str.indexOf(commandConfig.response_start ? commandConfig.response_start : "") + 1;
	var endIndex = str.length - ((commandConfig.crc_length ? commandConfig.crc_length : 0));
	
	str = str.substring(startIndex, endIndex);

	if(str.length > 1) {
		str = str.substring(commandConfig.response_header_length);
	}
	return str.trim();
}

/**
 * Get Json command object from command path
 * @function
 * @param {object} callsJson Json object that contains command objects
 * @param {string} path Path to command object to get
 * @returns {object} Json command object at path
 */

function getJsonCommandObjectFromPath(callsJson, path) {
	var ar = path.split("/").filter((e) => {return e.length > 0 ? true : false });
	var jsonCommandObject = callsJson;
	ar.forEach((element) => {
		jsonCommandObject = jsonCommandObject[element];
	});
	return jsonCommandObject;
}

/**
 * Get Json protocol config object from command path
 * @function
 * @param {object} callsJson Json object that contains protocol config objects
 * @param {string} path Path to protocol config object to get
 * @returns {object} Json protocol config object at command pat
 */

function getJsonConfigObjectFromPath(callsJson, path) {
	var ar = path.split("/").filter((e) => {return e.length > 0 ? true : false });
	if(ar.length > 0) {
		return callsJson[ar[0] + "_config"];
	}
}

function GetCacheObject(path) {
	if(path.endsWith("/cache")) {
		path = path.slice(0, path.length - "/cache".length);
	}

	//console.log("PATH: " + path);
	
	/*
	var ar = path.split("/").filter((e) => {return e.length > 0 ? true : false });
	console.log(ar);
	var cacheObject = cache;
	ar.forEach((element) => {
		cacheObject = cacheObject[element];
	});
	*/

	return cache[path];
}

function StoreInCache(path, data) {
	/*
	var ar = path.split("/").filter((e) => {return e.length > 0 ? true : false });
	console.log(ar);
	var cacheObject = {};
	ar.forEach((element) => {
		cacheObject[element] = {};
		cacheObject = cacheObject[element];
	});
	*/
	cache[path] = data;
}

/**
 * Split Data string to array
 * @function
 * @param {object} commandConfig Object that contains protocol config object
 * @param {string} str Data string to split
 * @returns {object} Data array
 */

function ResponseToDataArray(commandConfig, str) {
	var split_on = commandConfig.response_seperator 
	? commandConfig.response_seperator 
	: commandConfig.seperator ? commandConfig.seperator : "";

	return str.split(split_on);
}

/**
 * Send data to Influx db
 * @function
 * @param {string} data Data string to send
 */
function SendDataToInflux (data, url) {
	if (data) {
		log.info('influx:SEND', data);
		request.post({
			headers: {
				'content-type': 'application/x-www-form-urlencoded'
			},
			url: url ? url : session.influxUrl,
			body: data
		}, function (error, response, body) {
			if (error) {
				log.error('influx', error);
			}
		});
	}
}

/**
 * The command queue to add command to
 * @global
 */
var cmdQueue = new CommandQueue();

/**
 * The current command to recive reponse from
 * @global
 */
var reciveCommand;

var restartingSerialLock = false;

/**
 * Cache to store cached data reponses
 * @global
 */
var cache = {};

Object.keys(calls).filter((v) => { 
	return !v.endsWith("_config"); 
}).forEach((mainkey) => {
	//cache[mainkey] = {};
	Object.keys(calls[mainkey]).forEach((commandkey) => {
		cache[mainkey + "/" + commandkey] = calls[mainkey][commandkey].response;
	});
});

//console.log(JSON.stringify(cache));

function mpi() {

	/**
	 * Object for all callbacks
	 */
	this.callbacks;

	this.init = function(callbacks) {
		this.callbacks = callbacks;

		/**
		 * A serielport object to communicate to the inverter
		 * @global
		 */		
		const port = new SerialPort(session.serial_port, {
			baudRate: session.serial_baudrate
		});

		const parser = port.pipe(new Readline({ delimiter: session.serial_parsers_readline }));
		
		/**
		 * Send data to Converter on the serialport, checks the command queue and send command or log.
		 * Made to make the async serialport api to sync due to the sync responses from converter.
		 * @function
		 */		
		setInterval(function () {
			if (!restartingSerialLock && port.isOpen && cmdQueue.count() > 0 && reciveCommand == undefined) {
				if (cmdQueue.commands.length > 0) {
					reciveCommand = cmdQueue.getNextCommand();
				} else if (cmdQueue.logs.length > 0) {
					reciveCommand = cmdQueue.getNextLog();
				}

				if (reciveCommand != undefined) {
					log.info('serial:' + session.serial_port + ':SEND', reciveCommand.name);					
					log.info('serial:' + session.serial_port + ':SEND_RAW', JSON.stringify(reciveCommand.cmd));
					reciveCommand.cmd.forEach(function (cmd) {
						//cmd.forEach((v) => {console.log(v.toString(16));});
						
						port.write(cmd, function (error) {
							port.drain(function (error) {});
						});
					});
					reciveCommand.last = Date.now();
					reciveCommand.times++;
				}
			} else if (!restartingSerialLock && reciveCommand != undefined && Date.now() - reciveCommand.last > session.serial_restart_threshold) {
				restartingSerialLock = true;
				log.error('serial:' + session.serial_port, 'Reciving reached threshold ' + (Date.now() - reciveCommand.last) + 'ms (' + session.serial_restart_threshold + 'ms)')
				log.warn('serial:' + session.serial_port, 'Close serial port');
				port.close();
				log.info('serial:' + session.serial_port, 'Open serial port ');
				port.open();
				if(session.serial_clear_command_queue_on_restart) {
					cmdQueue.clearCommandQueue();
				}
				reciveCommand = undefined;
				restartingSerialLock = false;
			} else if (reciveCommand != undefined) {
				//console.log(Date.now() - reciveCommand.last);
				//console.log(session.serial_restart_threshold - (Date.now() - reciveCommand.last));
			}
		}, session.serial_queue_delay);

		var rootObjects = [];
		var childObjects = [];

		Object.keys(calls).filter((v) => { 
			return !v.endsWith("_config"); 
		}).forEach((key) => {
			rootObjects.push("/" + key);
			Object.keys(calls[key]).forEach((commad) => {
				if(!calls[key][commad].hide) {
					childObjects.push("/" + key + "/" + commad);
					if(calls[key][commad].cache) {
						childObjects.push("/" + key + "/" + commad + "/cache");
					}
				}
			});
		});
				
		//console.log("rootObjects: " + rootObjects);
		//console.log("childObjects: " + childObjects);
		/**
		 * Handle any request connect to defined protocols in json protocol definition
		 * @function
		 */
		app.get(rootObjects.concat(childObjects).concat(!session.ListenOn ? [] : Array.from(session.ListenOn, (word) => {return "/" + word})), (req, res) => {

			log.http("get:REQUEST", req.ip + ':' + req.originalUrl);					

			var path = req.path.slice(1);
			
			if(rootObjects.includes(req.path)) {
				res.send(calls[path]);
			} else if(path.endsWith("/cache")) {
				log.http("cache", 'Data found in cache for query');
				res.send(JSON.stringify(GetCacheObject(path)));
			} else {
				var queryVals = req.query;

				if(session.ListenOn.includes(path)) {
					var qc = session.QuickCommands[path];
					if(qc.before) {
						queryVals = this.callbacks[qc.before](queryVals);
					}
				}
				log.http('get', 'Query values: ' + JSON.stringify(queryVals));
				this.SendQuickCommand(path, queryVals, res);
			}

			// Vad man ska retunerar tillbaka till användare vid http get, json, array, string, eller callbacken
			// Fixa så att den tar hand om input värden och cheackar dessa
			// lägga till att behandla influx, mqtt plugin i plugin och session m.m.
			// Gör QucikCommands tillgängliga från webben
			// lägga till om set kommandon ska ha crc16, session och calls
			// lägga till logning till consol och fil på ett satt sätt
		});

		// Open serialport an start listen
		port.on('open', () => {
			//console.log('Port open');
			log.info('serial:' + session.serial_port, 'Open serial port');
			
			if(session.OnInit.RunCommands) {
				session.OnInit.RunCommands.forEach((element) => {
					this.SendQuickCommand(session.QuickCommands[element]);
				});
			}
			
			if(session.IntervalCommands) {
				//console.log(session.IntervalCommands);
				session.IntervalCommands.forEach((element) => {
					//var c = calls.query[element.command];
					var c = getJsonCommandObjectFromPath(calls, element.command);
					//console.log(c);
					var commandConfig = getJsonCommandObjectFromPath(calls, element.config);
					//console.log(commandConfig);
					var lc = new QueueCommand(element.command);
					lc.interval = element.interval;

					var commandCrc16 = "";		
					if((commandConfig.crc16 || c.crc16) && (("crc16" in c && c.crc16) || !("crc16" in c))) {
						commandCrc16 = GetCrc16(commandConfig.start_bit + c.command);
					}

					/*
					Buffer.from(CRC16(commandConfig.start_bit + c.command).toString(16), 'hex').forEach((b) => {
						console.log(b.toString(16));
					});

					console.log("commandCrc16: " + commandCrc16);
					*/

					lc.addCommand(commandConfig.start_bit + c.command + commandCrc16 + commandConfig.ending_character);
					if(element.callback && this.callbacks[element.callback]) {
						lc.callback = this.callbacks[element.callback];
					}
					log.info('queue:ADD_INTERVAL', lc.name + ':' + commandConfig.start_bit + c.command + commandCrc16 + commandConfig.ending_character);
					cmdQueue.addLogCommand(lc);
					//console.log(lc);
				});
			}
		});
		

		// Print error messsage if any error on serialport com
		port.on('error', function (error) {
			log.error('serial:' + session.serial_port, error);
			//console.log('error: ' + error);
		});

		// Event on new data on serialport
		parser.on('data', function (str) {
			log.info('serial:' + session.serial_port + ':RECIVED_RAW', 'Data: ' + str + " Length: " + str.length);
			//console.log('str: -' + str + "- length: " + str.length);
			if (!restartingSerialLock && reciveCommand != undefined) {

				reciveCommand.recived = true;

				log.info('serial:' + session.serial_port + ':RECIVED', reciveCommand.name);
				//console.log("Recive: " + reciveCommand.name);

				var commandConfig = (reciveCommand.config) 
				? getJsonCommandObjectFromPath(calls, reciveCommand.config) 
				: getJsonConfigObjectFromPath(calls, reciveCommand.name);

				var dataArray = ResponseToDataArray(commandConfig, ResponseRemoveHeader(commandConfig, str));
				var command = getJsonCommandObjectFromPath(calls, reciveCommand.name)
				if(command.response) {
					var mergedDataArray = MergeDataArray(command.response, dataArray);
				} else {						
					var mergedDataArray = MergeDataArray({"success": 1}, dataArray);
				}
				//console.log("mergedDataArray: " + JSON.stringify(mergedDataArray));
				var influxString = ToInfluxString(mergedDataArray);
				//console.log("influxString: " + influxString);
				if(reciveCommand.res) {
					reciveCommand.res.send(JSON.stringify(mergedDataArray));
				}
				//console.log("command.influx:" + command.influx);
				if(command.influx) {
					//console.log(session.influx_pre_header + reciveCommand.name.replace("/", "_") + " " + influxString);
					SendDataToInflux(session.influx_pre_header + reciveCommand.name.replace("/", "_") + " " + influxString);
				}

				if(command.cache) {
					StoreInCache(reciveCommand.name, mergedDataArray);
				}

				if (reciveCommand.callback != undefined) {
					//console.log("str: " + str);

					reciveCommand.callback(reciveCommand, ResponseRemoveHeader(commandConfig, str), dataArray, mergedDataArray, influxString);
				}

				reciveCommand = undefined;
			}
		});
		
		// Start listen on http get on localhost:session_port
		app.listen(session.http_port, function () {
			log.http('localhost', "Listening on port: " + session.http_port);
			//console.log('Listening on port: ' + session.http_port);
		});
	}

	/**
	 * Create a command and put it on the send queue
	 * @function
	 * @param {string} quickcommand Path to call or name of QuickCommand to send
	 * @param {object} value Parameters matching the command variables in calls
	 */
	this.SendQuickCommand = function(quickcommand, value, response) {
		if(Object.keys(session.QuickCommands).includes(quickcommand)) {
			quickcommand = session.QuickCommands[quickcommand];
		}

		var qc = new QueueCommand(quickcommand.command ? quickcommand.command : quickcommand);

		var c = (quickcommand.command) 
			? getJsonCommandObjectFromPath(calls, quickcommand.command) 
			: getJsonCommandObjectFromPath(calls, quickcommand);
		//console.log("quickcommand.command: " + c);

		var commandConfig = (quickcommand.config) 
			? getJsonCommandObjectFromPath(calls, quickcommand.config) 
			: getJsonConfigObjectFromPath(calls, quickcommand);
		//console.log("commandConfig: " + commandConfig);

		var valueString = "";
		if(!value && quickcommand.default_value) {
			value = quickcommand.default_value;
		}
		if(value && c.variables) {
			//console.log("value: " + value)

			var variablesInOrder = {};

			Object.keys(c.variables).forEach((key) => {
				if(value[key]) {
					variablesInOrder[key] = value[key];
				}
			});

			Object.keys(variablesInOrder).forEach((key) => {
				var v = variablesInOrder[key];
				var cv = c.variables[key];

				if(Number(v) && Array.isArray(cv)) {
					v = Number(v);
					if(cv.length > 1 && v < cv[1]) {
						v = cv[1];
					} else if (cv.length > 2 && v > cv[2]) {
						v = cv[2];
					}
					v = v.toString();
					
					if(cv.length > 0) {
						for(var s = 0; s < cv[0]; s++) {
							v = commandConfig.variable_length_fillout + v;
						}

						v = v.slice(-(cv[0]));
					}

				} else {
					v = v + cv;
				}

				valueString += v + commandConfig.seperator;
			});
		}

		valueString = valueString.slice(0, valueString.length -1);

		//console.log("valueString: " + valueString);
		//console.log("command: " + commandConfig.start_bit + c.command + valueString + commandConfig.ending_character);
		
		var sum_crc = "";
		if(c.sum_crc) {
			sum_crc = commandConfig.start_bit + c.command + valueString;
			var sum = 0;
			sum_crc.split('').forEach((e) => {
				//console.log(e.charCodeAt(0).toString(16));
				sum += Number(e.charCodeAt(0));
			});
			sum_crc = sum.toString(16);
		}

		var commandCrc16 = "";		
		if((commandConfig.crc16 || c.crc16) && (("crc16" in c && c.crc16) || !("crc16" in c))) {
			commandCrc16 = GetCrc16(commandConfig.start_bit + c.command + valueString);
		}
		
		//console.log("commandCrc16: " + commandCrc16);

		qc.addCommand(commandConfig.start_bit + c.command + valueString + sum_crc + commandCrc16 + commandConfig.ending_character);

		if(quickcommand.callback && this.callbacks[quickcommand.callback]) {
			qc.callback = this.callbacks[quickcommand.callback];
		} else if (c.callback) {
			qc.callback = c.callback;
		}

		if(response) {
			qc.res = response;
		}

		log.info('queue:ADD', qc.name + ': ' + commandConfig.start_bit + c.command + valueString + sum_crc + commandCrc16 + commandConfig.ending_character);		
		cmdQueue.addCommand(qc);
	}
}
