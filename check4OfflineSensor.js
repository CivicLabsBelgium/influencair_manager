const request = require('request')
const Parse = require('parse/node')
const WebClient = require('@slack/client').WebClient

const log = (logMessage) => {
  process.stdout.write(logMessage + '\n')
}

exports.check = () => {
  if (process.env.slackBotToken === undefined || process.env.parseAppId === undefined) {
    log('Provide \'slackBotToken\' & \'accessKey\' with the environment')
    process.exit(1)
  }

  Parse.initialize(process.env.parseAppId)
  Parse.serverURL = 'https://01.parse.appsaloon.be/sds011/parse'
  const ParseSensor = Parse.Object.extend('Sensor')
  const query = new Parse.Query(ParseSensor)
  const web = new WebClient(process.env.slackBotToken)

    // get list of all live sensors for brussels from luftdaten
    // https://api.luftdaten.info/v1/filter/area=50.8531,4.3550,20&type=SDS011
    // you end up with a list of 2 readings for each sensor
  const luftdatenSensorUrl = 'https://api.luftdaten.info/v1/filter/area=50.8531,4.3550,20&type=SDS011'

  request({
    url: luftdatenSensorUrl,
    json: true
  }, function (error, response, body) {
    if (!error && response.statusCode === 200) {
      const sensors = body.reduce((sensorList, measurement) => {
        const sensor = measurement.sensor
        const sensorExist = sensorList.find(sensorFromList => {
          return sensorFromList.id === sensor.id
        })
        if (!sensorExist) sensorList.push(sensor)
        return sensorList
      }, [])

      query.find({
        success: function (results) {
          const offlineSensors = results.filter(sensor => {
            const sensorIsLive = sensors.find(s => {
              return s.id === sensor.get('luftdatenId')
            })
            return !sensorIsLive
          })

          offlineSensors.forEach(sensor => {
            if (sensor.get('offlineCounter') === 11) {
                            //
            }
            sensor.set('live', false)
            sensor.increment('offlineCounter')
            sensor.save()
          })

          const onlineSensors = results.filter(sensor => {
            const sensorIsLive = sensors.find(s => {
              return s.id === sensor.get('luftdatenId')
            })
            return sensorIsLive
          })

          onlineSensors.forEach(sensor => {
            if (sensor.get('offlineCounter') > 0) {
              sensor.set('live', true)
              sensor.set('offlineCounter', 0)
              sensor.save()
            }
          })
                    // console.log(offlineSensors)
                    // get list of all new online sensors we don't have in our list
          const newOnlineSensors = sensors.filter(sensor => {
            const sensorIsRegistered = results.find(s => {
              return s.get('luftdatenId') === sensor.id
            })
            return !(sensorIsRegistered)
          })

          newOnlineSensors.forEach(sensor => {
            const newSensor = new ParseSensor()
            newSensor.set('luftdatenId', sensor.id)
            newSensor.set('live', true)
            newSensor.save()
            const message = 'Big news, I just found a new sensor with ID ' + sensor.id
            web.chat.postMessage('sensor-network_status', message, {username: 'sensor-checker'})
          })

          const statusMessage = `online: ${sensors.length}/${results.length}`

          web.chat.postMessage('sensor-network_status', statusMessage, {username: 'sensor-checker'})

          offlineSensors.forEach(sensor => {
            const slackHandler = sensor.get('alertSlack')
            let message = ''
            if (slackHandler) {
              message = '<@' + slackHandler + '> your sensor with ID ' + sensor.get('luftdatenId') + ' is offline'
            } else {
              message = 'Sensor with ID' + sensor.get('luftdatenId') + 'is offline'
            }
            web.chat.postMessage('sensor-network_status', message, {link_names: true, username: 'sensor-checker'})
          })
        },
        error: function (error) {
          process.stdout.write('Error: ' + error.code + ' ' + error.message)
        }
      })
    }
  })
}
