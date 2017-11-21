'use strict';

// Modules imports
const functions = require('firebase-functions');
const crypto = require('crypto');

// Verify pin and exchange for Firebase Custom Auth token
exports.verifyPin = functions.https.onRequest((req, res) => {
  if (req.method !== 'POST') {
    return res.sendStatus(403);
  }
  const pin = req.body.pin;
  if (pin === undefined) {
    return res.sendStatus(400);
  }
  return admin.database().ref('/player-pins/' + pin).once('value').then(function (snapshot) {
    if (!snapshot.exists()) {
      throw Error('', 400);
    }
    const data = {
      accountId: snapshot.accountId,
      id: snapshot.playerId || crypto.randomBytes(20).toString('hex')
    };
    return snapshot.ref.remove().then(function () {
      return data;
    })
  }).then(function (data) {
    const uid = `player:${data.id}`;
    return admin.auth().getUser(uid).catch(error => {
      if (error.code === 'auth/user-not-found') {
        return admin.auth().createUser({
          uid: uid
        });
      }
      // If error other than auth/user-not-found occurred, fail the whole login process
      throw error;
    }).then(function (user) {
      return db.ref('players/' + data.accountId + '/' + user.uid).set({'title': ''}).then(function () {

      return admin.database().ref('/accounts/' + data.accountId + '/players').
    });
  }).then(function (authToken) {
    return res.status(200).send({token: authToken});
  }).catch(function (error) {
    return res.sendStatus(error.id);
  });
})
