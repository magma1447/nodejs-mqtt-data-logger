#!/usr/bin/nodejs

// Config
var config = {
	mqtt: 'mqtt://ha-01.localnet:1883',
	topics: [
		{ topic: 'shellies/+/relay/+/energy', type: 'energy', multiplier: 0.01, decimals: 3, unit: 'kWh', resetingCounter: true }
	],
	keep: {
		// If integer, keep number of days.
		// If false, don't aggregate into this time interval.
		// If true, don't purge
		raw: 500,
		hourly: 1100,
		daily: true,
	},
}


var DataLogger = {
	schedule: null,
	lastValues: {},	// Relevant for resetingCounters and to not write the same value twice in a row.
	queue: [],
	queueLock: false,

	Init: function() {
		if(config.keep.raw) {
			DataLogger.schedule.scheduleJob('1 0 * * *', function() { DataLogger.HandleRawData() });
		}
		if(config.keep.hourly) {
			DataLogger.schedule.scheduleJob('1 * * * *', function() { DataLogger.HandleHourlyData() });
		}
		if(config.keep.daily) {
			DataLogger.schedule.scheduleJob('1 0 * * *', function() { DataLogger.HandleDailyData() });
		}

		DB.AggregateHourlyData();
		DB.AggregateDailyData();
	},

	HandleRawData: function() {
		console.info('Handling raw data');
		// Purge
		if(config.keep.raw !== true) {
			DB.DeleteOldRawData(config.keep.raw);
		}
	},
	HandleHourlyData: function() {
		// Aggregate
		DB.AggregateHourlyData();

		// Purge
		// FIXME IMPLEMENT
	},
	HandleDailyData: function() {
		// Aggregate
		DB.AggregateDailyData();

		// Purge
		// FIXME IMPLEMENT
	},

	AddIncomingMqttDataToQueue: function(topic, value) {
		var job = { topic: topic, rawValue: value.toString() };
		console.info('Adding job: ' + topic + ' => ' + value);
		DataLogger.queue.push(job);
		DataLogger.TriggerQueue();
	},
	TriggerQueue: function() {
		if(DataLogger.queueLock || !DataLogger.queue.length) {
			return;
		}
		DataLogger.queueLock = true;

		// Fetch latest value
		job = DataLogger.queue[0];
		if(typeof(DataLogger.lastValues[job.topic]) === 'undefined') {
			let callback = function(topic, rawValue) {
				return function(error, row) {
					if(error) {
						console.error(error);
						process.exit(1);
					}
					if(typeof(row) === 'undefined') {
						console.info('New topic found: ' + topic + ' => ' + rawValue);
						DataLogger.lastValues[topic] = {rawValue: false, calculatedValue: 0};
					} else {
						console.info('Old topic restored: ' + topic + ' => rawValue:' + row.raw_value + ' calculatedValue:' + row.calculated_value);
						DataLogger.lastValues[topic] = {rawValue: Number(row.raw_value), calculatedValue: Number(row.calculated_value)};
					}

					DataLogger.TriggerQueue();
				}
			}
			DB.GetLatestValueForTopic(job.topic, job.rawValue, callback);
			DataLogger.queueLock = false;
			return;
		}
		// --


		// Check if counter has increased
		if(DataLogger.lastValues[job.topic].rawValue === false) {
			DataLogger.lastValues[job.topic].rawValue = 0;
		}
		else if(job.rawValue == DataLogger.lastValues[job.topic].rawValue) {
			console.info('Counter not incremented, discarding job');
			DataLogger.queue.shift();
			DataLogger.queueLock = false;
			return;
		}
		// --


		var match = MQTT.GetMatchingTopic(job.topic);

		if(match.resetingCounter && job.rawValue < DataLogger.lastValues[job.topic].rawValue) {
			var calculatedValue = Number(job.rawValue);
		} else {
			var calculatedValue = Number(job.rawValue) - DataLogger.lastValues[job.topic].rawValue;
		}

		if(calculatedValue === 'NaN') {
			// DataLogger.queueLock = false;
			// return false;
			console.error('calculatedValue NaN');
			process.exit(1);
		}

		if(typeof(match.multiplier) !== 'undefined') {
			calculatedValue = calculatedValue * match.multiplier;
		}
		if(typeof(match.decimals) !== 'undefined') {
			calculatedValue = Number(calculatedValue.toFixed(match.decimals));
		} else {
			calculatedValue = Number(calculatedValue);
		}

		// Publish the calculated total kWh value to MQTT for other services to use
		// if(match.resetingCounter) {
		// 	let publishTopic = job.topic + '_total';
		// 	MQTT.mqttClient.publish(publishTopic, calculatedValue.toString(), {retain: true});
		// }


		console.info('Writing to database: ' + job.topic + ' rawValue:' + job.rawValue + ' calculatedValue:' + calculatedValue, ' lastRaw:' + DataLogger.lastValues[job.topic].rawValue);
		DB.AddRawValue(job.topic, job.rawValue, calculatedValue);
		DataLogger.lastValues[job.topic] = {rawValue: Number(job.rawValue), calculatedValue: Number(calculatedValue)};

		DataLogger.queue.shift();
		DataLogger.queueLock = false;
		return;
	},
}

var MQTT = {
	mqtt: null,
	mqttClient: null,
	mqttMatch: null,

	Init: function() {
		// Connecting to MQTT
		console.info('Connecting to MQTT');
		MQTT.mqttClient = MQTT.mqtt.connect(config.mqtt);

		// Subscribing to topics
		MQTT.mqttClient.on('connect', function() {
			MQTT.mqttClient.subscribe(MQTT.GetTopics(), function(err) {
				if(err) {
					console.error(err);
					process.exit(1);
				}
				console.info('Connected to MQTT');
			});
		});

		// Handle MQTT message callbacks
		MQTT.mqttClient.on('message', function(topic, value) {
			// DataLogger.ParseData(topic, value.toString());
			DataLogger.AddIncomingMqttDataToQueue(topic, value);
		});

	},
	GetTopics: function() {
		var topics = [];
		config.topics.forEach(function(topic) {
			topics.push(topic.topic);
		});
		return topics
	},
	GetMatchingTopic: function(topic) {
		var match = null;
		config.topics.forEach(function(topic2, index) {
			if(MQTT.mqttMatch(topic2.topic, topic)) {
				match = topic2;
			}
		});
		return match;
	},
}

var DB = {
	sqlite3: null,
	db: null,

	dbSchema: `
	CREATE TABLE IF NOT EXISTS raw_data (
	  id INTEGER NOT NULL PRIMARY KEY,
	  topic TEXT NOT NULL,
	  timestamp NUMERIC NOT NULL,
	  raw_value REAL NOT NULL,
	  calculated_value REAL NOT NULL
	);
	CREATE UNIQUE INDEX IF NOT EXISTS rawdata_uidx on raw_data (topic, timestamp);

	CREATE TABLE IF NOT EXISTS hourly_data (
	  id INTEGER NOT NULL PRIMARY KEY,
	  topic TEXT NOT NULL,
	  timestamp NUMERIC NOT NULL,
	  value REAL NOT NULL
	);
	CREATE UNIQUE INDEX IF NOT EXISTS hourlydata_uidx on hourly_data (topic, timestamp);

	CREATE TABLE IF NOT EXISTS daily_data (
	  id INTEGER NOT NULL PRIMARY KEY,
	  topic TEXT NOT NULL,
	  timestamp NUMERIC NOT NULL,
	  value REAL NOT NULL
	);
	CREATE UNIQUE INDEX IF NOT EXISTS dailydata_uidx on daily_data (topic, timestamp);
	`,
	Init: function() {
		// Connecting to database
		console.info('Connecting database');
		DB.db = new DB.sqlite3.Database('nodejs-mqtt-data-logger.db', (err) => {
			if(err) {
				console.error(err.message);
				process.exit(1);
			}
			console.info('Database connected');
		});

		// Installing database schema if it doesn't exist
		DB.db.exec(DB.dbSchema, function(err) {
			if(err) {
				console.error(err);
				process.exit(1);
			}
		});
	},
	AddRawValue: function(topic, rawValue, value) {
		let sql = "INSERT INTO raw_data (topic, timestamp, raw_value, calculated_value) VALUES (?, DATETIME(), ?, ?)";
		DB.db.run(sql, [topic, rawValue, value], function(error) {
			if(error) {
				console.error(error);
				process.exit(1);
			}
		});
	},
	GetLatestValueForTopic: function(topic, rawValue, callback) {
		let sql = "SELECT topic, raw_value, calculated_value FROM raw_data WHERE topic = ? ORDER BY timestamp DESC LIMIT 1";
		DB.db.get(sql, [topic], callback(topic, rawValue));

	},

	DeleteOldRawData: function(days) {
		days = Number(days);
		if(!days) {
			console.error('raw days is 0');
			process.exit(1);
		}
		let sql = "DELETE FROM raw_data WHERE timestamp < DATE(DATETIME('now', '-" + days + " day'))";
		DB.db.run(sql, [], function(error) {
			if(error) {
				console.error(error);
				process.exit(1);
			}
		});
	},
	AggregateHourlyData: function() {
		// Get the first YYYY-MM-DD HH:00:00 that doesn't exist in table hourly_data
		let sql = "SELECT STRFTIME('%Y-%m-%d %H:00:00', MAX(timestamp)) AS timestamp FROM hourly_data";
		DB.db.get(sql, [], function(error, row) {
			if(error) {
				console.error(error);
				process.exit(1);
			}
			DB.AggregateHourlyDataFrom(row.timestamp);
		});
	},
	AggregateHourlyDataFrom: function(timestamp) {
		if(timestamp === null) {
			timestamp = '1970-01-01 00:00';
		}
		console.info('AggregateHourlyDataFrom: ' + timestamp)

		let sql = "INSERT INTO hourly_data (topic, timestamp, value) SELECT topic, STRFTIME('%Y-%m-%d %H:00:00', DATETIME(timestamp, '1 hour')) AS ymdh, SUM(calculated_value) AS value FROM raw_data WHERE timestamp >= ? AND timestamp < STRFTIME('%Y-%m-%d %H:00:00', 'now') GROUP BY topic, ymdh";
		DB.db.run(sql, [timestamp], function(error) {
			if(error) {
				console.error(error);
				process.exit(1);
			}
		});
	},

	AggregateDailyData: function() {
		// Get the first YYYY-MM-DD 00:00:00 that doesn't exist in table daily_data
		let sql = "SELECT STRFTIME('%Y-%m-%d 00:00:00', MAX(timestamp)) AS timestamp FROM daily_data";
		DB.db.get(sql, [], function(error, row) {
			if(error) {
				console.error(error);
				process.exit(1);
			}
			DB.AggregateDailyDataFrom(row.timestamp);
		});
	},
	AggregateDailyDataFrom: function(timestamp) {
		if(timestamp === null) {
			timestamp = '1970-01-01 00:00';
		}
		console.info('AggregateDailyDataFrom: ' + timestamp)

		let sql = "INSERT INTO daily_data (topic, timestamp, value) SELECT topic, STRFTIME('%Y-%m-%d 00:00:00', DATETIME(timestamp, '1 day')) AS ymd, SUM(calculated_value) AS value FROM raw_data WHERE timestamp >= ? AND timestamp < STRFTIME('%Y-%m-%d 00:00:00', 'now') GROUP BY topic, ymd";
		DB.db.run(sql, [timestamp], function(error) {
			if(error) {
				console.error(error);
				process.exit(1);
			}
		});
	},
}



// Main
MQTT.mqtt = require('mqtt');
MQTT.mqttMatch = require('mqtt-match');
DB.sqlite3 = require('sqlite3').verbose();
DataLogger.schedule = require('node-schedule');


DB.Init();
MQTT.Init();
DataLogger.Init();


// HTTP
const express = require('express');
const app = express();
const port = 3000;

app.get('/ajax/gethourlydata', function (req, res) {
	let sql = "SELECT topic, STRFTIME('%s', timestamp) || '000' AS timestamp, value FROM hourly_data";
	DB.db.all(sql, [], function(error, rows) {
		var data = {};
		rows.forEach(function(row) {
			if(typeof(data[row.topic]) === 'undefined') {
				data[row.topic] = [];
			}

			data[row.topic].push([Number(row.timestamp), Number(row.value.toFixed(5))]);
		});

		res.send(JSON.stringify(data));
	});
});
app.use(express.static('public'));

app.use(function (req, res, next) {
	res.status(404).send("Error 404")
});

app.listen(port, () => console.info(`HTTP server listening on port ${port}!`));
// -- HTTP


// mqttClient.end()
// db.close()
