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
	lastValues: {},	// Relevant for resetingCounters and to not write the same value twice

	ParseData: function(topic, rawValue) {
		var match = MQTT.GetMatchingTopic(topic);


		// If we don't have a value stored, fetch from the database
		if(typeof(DL.lastValues[topic]) === 'undefined') {
			let callback = function(topic, rawValue) {
				return function(error, row) {
					if(error) {
						console.error(error);
						process.exit(1);
					}
					if(typeof(row) === 'undefined') {
						console.log('New topic found: ' + topic);
						DL.lastValues[topic] = 0;
						DL.ParseData(topic, rawValue);
					} else {
						DL.lastValues[topic] = row.raw_value;
					}
				}
			}
			// DB.GetLatestValueForTopic(topic, callback(topic, rawValue));
			let sql = "SELECT topic, raw_value FROM raw_data WHERE topic = ? ORDER BY timestamp DESC LIMIT 1";
			DB.db.get(sql, [topic], callback(topic, rawValue));

		} else {

			value = Number(rawValue);
			if(value === 'NaN') {
				return false;
			}

			if(match.resetingCounter && value < DL.lastValues[topic]) {
				value = value + DL.lastValues[topic];
			}

			if(typeof(match.multiplier) !== 'undefined') {
				value = value * match.multiplier;
			}
			if(typeof(match.decimals) !== 'undefined') {
				value = value.toFixed(match.decimals);
			} else {
				value = Number(value)
			}


			if(rawValue != DL.lastValues[topic]) {
				console.log('WRITING topic: ' + topic + ' rawValue:' + rawValue + ' value: ' + value, ' last: ' + DL.lastValues[topic]);
				DB.AddValue(topic, rawValue, value);
				DL.lastValues[topic] = rawValue;
			}
		}

		return true;
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
			DL.ParseData(topic, value.toString());
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
	GetLatestValueForTopic: function(topic, callback) {
		let sql = "SELECT topic, raw_value FROM raw_data WHERE topic = ? ORDER BY timestamp DESC LIMIT 1";
		DB.db.get(sql, [topic], callback());
	},
	AddValue: function(topic, rawValue, value) {
		let sql = "INSERT INTO raw_data (topic, timestamp, raw_value, calculated_value) VALUES (?, datetime(), ?, ?)";
		DB.db.run(sql, [topic, rawValue, value], function(error) {
			if(error) {
				console.error(error);
				process.exit(1);
			}
		});

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
