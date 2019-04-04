#!/usr/bin/nodejs

// Config
var config = {
	mqtt: 'mqtt://ha-01.localnet:1883',
	topics: [
		{ topic: 'shellies/+/relay/+/energy', type: 'energy', multiplier: 0.01, decimals: 3, unit: 'kWh', resetingCounter: true }
	]
}


var MQTT = {
	mqtt: null,
	mqttMatch: null,

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
		DB.db.exec(DB.dbSchema, function(err) {
			if(err) {
				console.error(err);
				process.exit(1);
			}
		});
	}

}



// Main
MQTT.mqtt = require('mqtt');
MQTT.mqttMatch = require('mqtt-match');
var sqlite3 = require('sqlite3').verbose();


console.info('Connecting database');
DB.db = new sqlite3.Database('nodejs-mqtt-data-logger.db', (err) => {
	console.log(err);
	if(err) {
		console.error(err.message);
		process.exit(1);
	}
	console.info('Database connected');
});
DB.Init();



console.info('Connecting to MQTT');
var mqttClient = MQTT.mqtt.connect(config.mqtt);

mqttClient.on('connect', function() {
	mqttClient.subscribe(MQTT.GetTopics(), function(err) {
		if(err) {
			console.error(err);
			process.exit(1);
		}
		console.info('Connected to MQTT');
	});
});

mqttClient.on('message', function(topic, value) {
	var match = MQTT.GetMatchingTopic(topic);

	value = Number(value);
	if(value !== 'NaN') {
		if(typeof(match.multiplier) !== 'undefined') {
			value = value * match.multiplier;
		}
		if(typeof(match.decimals) !== 'undefined') {
			value = value.toFixed(match.decimals);
		} else {
			value = Number(value)
		}
		console.info(topic + ': ' + value + ' ' + match.unit);
	}
});



// mqttClient.end()
// db.close()
