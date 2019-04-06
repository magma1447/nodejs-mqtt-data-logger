# nodejs-mqtt-data-logger
**THIS IS A WORK IN PROGRESS**

It's far from complete and this far not usable at all.

## What is this?
I was looking for a decent way to long-term log my energy usage for some outlets. Charting wasn't the most important part, but seeing exact values of kWh used per month several years back was important. Since I didn't find a complete solution for that I started writing this.

This should run as a daemon and will then read data from a MQTT Broker to which energy usage is sent. The read data will then be stored into a database (SQLite). Only changes will be written and on an hourly basis it will aggregate energy usage into daily values. Detailed (raw) data entries will be deleted after a defined number of days.

# TODO list
- [x] Log data to SQLite.
- [x] Handle counters from hardware that resets the value from time to time (Shelly for example).
- [ ] Add HTTP support to view the data.
- [x] Aggregate hourly data into another database table.
- [ ] Aggregate daily data into another database table.
- [x] Remove detailed (raw) data after X number of days.
- [ ] Remove data from hourly/daily as well.

## Dependencies
* [mqtt](https://www.npmjs.com/package/mqtt)
* [mqtt-match](https://www.npmjs.com/package/mqtt-match)
* [sqlite3](https://www.npmjs.com/package/sqlite3)
* [node-schedule](https://www.npmjs.com/package/node-schedule)

### Dependencies not yet added/implemented
* [highcharts](https://www.npmjs.com/package/highcharts)

### Reference to built-in http support
* [http](https://www.w3schools.com/nodejs/nodejs_http.asp)
