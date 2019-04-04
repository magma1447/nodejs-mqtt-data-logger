#!/usr/bin/nodejs

// Config
var config = {
	mqtt: 'mqtt://ha-01.localnet:1883',
	topics: [
		{ topic: 'shellies/+/relay/+/energy', type: 'energy', multiplier: 0.01, unit: 'kWh', resetingCounter: true }
	]
}



function GetMqttTopics() {
	var topics = [];
	config.topics.forEach(function(topic) {
		topics.push(topic.topic);
	})
	return topics
}

function GetMatchingTopic(topic) {
	var match = null;
	config.topics.forEach(function(topic2, index) {
		if(mqttMatch(topic2.topic, topic)) {
			match = topic2;
		}
	})
	return match;
}



// Main
var mqtt = require('mqtt');
var mqttMatch = require('mqtt-match');
var db = require('sqlite3').verbose();


var mqttClient = mqtt.connect(config.mqtt);

mqttClient.on('connect', function() {
	mqttClient.subscribe(GetMqttTopics(), function(err) {
		if(!err) {
			console.info('Connected to MQTT');
		}
	})
})

mqttClient.on('message', function(topic, value) {
	var match = GetMatchingTopic(topic);

	value = Number(value);
	if(value !== 'NaN') {
		if(typeof(match.multiplier) !== 'undefined') {
			value = value * match.multiplier;
		}
		console.info(topic + ': ' + value + ' ' + match.unit);
	}
})



// mqttClient.end()
