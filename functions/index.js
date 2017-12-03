'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);
const request = require('request-promise');
const emojiFlags = require('emoji-flags');
const Twitter = require('twitter');
const geolib = require('geolib');
const cors = require('cors')({origin: true});


exports.update_location = functions.database.ref('/users/{uid}/location').onWrite(event => {
  const snapshot = event.data;

  const lat = snapshot.val().lat;
  const lon = snapshot.val().lon;

  const promises = [];

  if (snapshot.previous.exists()) {
      const oldLat = snapshot.previous.val().lat;
      const oldLon = snapshot.previous.val().lon;
      const distance = geolib.getDistanceSimple(
        {latitude: lat, longitude: lon},
        {latitude: oldLat, longitude: oldLon}
      );

      if (distance < 100 * 1000) { // 100 km
        promises.push(Promise.resolve());
      } else {
        promises.push(createReverseGeocodePromise(lat, lon, event.params.uid));
      }
  } else {
    promises.push(createReverseGeocodePromise(lat, lon, event.params.uid));
  }

  return Promise.all(promises);
});

function createReverseGeocodeUrl(lat, lon) {
  return `https://maps.googleapis.com/maps/api/geocode/json?language=en&key=${functions.config().firebase.apiKey}&latlng=${lat},${lon}`;
}

function createReverseGeocodePromise(lat, lon, uid) {

  return request(createReverseGeocodeUrl(lat, lon), {resolveWithFullResponse: true}).then(
      response => {
        if (response.statusCode === 200) {
          const data = JSON.parse(response.body);
          const address = getCountry(data.results[0].address_components);
          const emoji = emojiFlags.countryCode(address["country_short"]) != undefined ? emojiFlags.countryCode(address["country_short"]).emoji : ""
          return admin.database().ref(`/users/${uid}/public`)
              .update({"country": address["country"], "city": address["city"], "country_short": address["country_short"], "country_emoji": emoji}).then( function() {

                    var ref = admin.database().ref(`/users/${uid}/twitter`);
                    ref.once("value", function(twitter) {
                        // is twitter authenticated?
                        if (twitter.val() != null) {
                            var twitterClient = new Twitter({
                              consumer_key: functions.config().twitter.consumer_key,
                              consumer_secret: functions.config().twitter.consumer_secret,
                              access_token_key: twitter.val().token,
                              access_token_secret: twitter.val().token_secret
                            });

                            var params = {'location': emoji + ' ' + address["city"] + ', ' + address["country"]};
                            twitterClient.post('account/update_profile.json', params, function(error, profile, response) {
                                if (error) {
                                    console.error("Error updating twitter location:", error);
                                }
                            });
                        }
                    });
              }
          );    
        }
        throw response.body;
  });
}

function getCountry(addrComponents) {
    var address = {}; 
    for (var i = 0; i < addrComponents.length; i++) {
        if (addrComponents[i].types[0] == "country") {
            address["country_short"] = addrComponents[i].short_name;
            address["country"] = addrComponents[i].long_name;
        }
        if (addrComponents[i].types[0] == "locality") {
            address["city"] = addrComponents[i].long_name;
        }
    }
    return address;
}

function findUsersMatchingEmail( emailAddress, callback ) {
    admin.auth().getUserByEmail(emailAddress)
      .then(function(userRecord) {
        // See the UserRecord reference doc for the contents of userRecord.
        console.log("Successfully fetched user data:", userRecord.toJSON());
        callback(userRecord.uid);
      })
      .catch(function(error) {
        console.log("Error fetching user data:", error);
        callback(null);
      });
}

exports.user_by_email = functions.https.onRequest((req, res) => {
  if (req.method === 'PUT') {
    res.status(403).send('Forbidden!');
  }

  cors(req, res, () => {
    let email = req.query.email;
    if (!email) {
      email = req.body.email;
    }
   
    findUsersMatchingEmail(email, function(user_id) {
        if (user_id) {
            res.status(200).send(user_id);
        } else {
            res.sendStatus(404);
        }
    });

  });
});