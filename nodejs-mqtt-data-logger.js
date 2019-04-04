#!/usr/bin/nodejs

// Config
var config = {
	mqtt: 'mqtt://ha-01.localnet:1883',
	topics: [
		{ topic: 'shellies/+/relay/+/energy', type: 'energy', multiplier: 0.01, decimals: 3, unit: 'kWh', resetingCounter: true }
	]
}


// Data logger
var DL = {
	lastValues: {},	// Relevant for resetingCounters and to not write the same value twice in a row.
	queue: [],
	queueLock: false,

	AddIncomingMqttDataToQueue: function(topic, value) {
		var job = { topic: topic, rawValue: value.toString() };
		console.log('Adding job: ' + topic + ' => ' + value);
		DL.queue.push(job);
	},
	TriggerQueue: function() {
		if(DL.queueLock || !DL.queue.length) {
			return;
		}
		DL.queueLock = true;

		job = DL.queue[0];
		if(typeof(DL.lastValues[job.topic]) === 'undefined') {

			let callback = function(topic, rawValue) {
				return function(error, row) {
					if(error) {
						console.error(error);
						process.exit(1);
					}
					if(typeof(row) === 'undefined') {
						console.log('New topic found: ' + topic + ' => ' + rawValue);
						DL.lastValues[topic] = rawValue;
					} else {
						console.log('Old topic restored: ' + topic + ' => ' + row.raw_value);
						DL.lastValues[topic] = row.raw_value;
					}

					DL.TriggerQueue();
				}
			}
			DB.GetLatestValueForTopic(job.topic, job.rawValue, callback);
			DL.queueLock = false;
			return;
		}

		if(job.rawValue != DL.lastValues[job.topic]) {
			var match = MQTT.GetMatchingTopic(job.topic);

			value = Number(job.rawValue);
			if(value === 'NaN') {
				DL.queueLock = false;
				return false;
			}

			if(match.resetingCounter && job.rawValue < DL.lastValues[job.topic]) {
				value = value + DL.lastValues[job.topic];
			}

			if(typeof(match.multiplier) !== 'undefined') {
				value = value * match.multiplier;
			}
			if(typeof(match.decimals) !== 'undefined') {
				value = value.toFixed(match.decimals);
			} else {
				value = Number(value);
			}

			console.log('Writing to database: ' + job.topic + ' rawValue:' + job.rawValue + ' value: ' + value, ' lastRaw: ' + DL.lastValues[job.topic]);
			DB.AddRawValue(job.topic, job.rawValue, value);
			DL.lastValues[job.topic] = job.rawValue;
			DL.queue.shift();
			DL.queueLock = false;
			return;
		}

		DL.queueLock = false;
		return;
	}
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
			// DL.ParseData(topic, value.toString());
			DL.AddIncomingMqttDataToQueue(topic, value);
			DL.TriggerQueue();
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
	}

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
		let sql = "INSERT INTO raw_data (topic, timestamp, raw_value, calculated_value) VALUES (?, datetime(), ?, ?)";
		DB.db.run(sql, [topic, rawValue, value], function(error) {
			if(error) {
				console.error(error);
				process.exit(1);
			}
		});
	},
	GetLatestValueForTopic: function(topic, rawValue, callback) {
		let sql = "SELECT topic, raw_value FROM raw_data WHERE topic = ? ORDER BY timestamp DESC LIMIT 1";
		DB.db.get(sql, [topic], callback(topic, rawValue));

	}

}



// Main
MQTT.mqtt = require('mqtt');
MQTT.mqttMatch = require('mqtt-match');
DB.sqlite3 = require('sqlite3').verbose();


DB.Init();
MQTT.Init();





// mqttClient.end()
// db.close()
