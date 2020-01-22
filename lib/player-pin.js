'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

exports.update = functions.database.ref('player-pins/{pin}').onCreate((snapshot, context) => {
  const pin = context.params.pin;
  const data = snapshot.val() || {};
  if (data.accessToken || !data.accountId) {
    return null
  }
  const playerId = crypto.randomBytes(20).toString('hex');
  const uid = `player:${playerId}`;
  return admin.auth().getUser(uid).catch(error => {
    if (error.code === 'auth/user-not-found') {
      return admin.auth().createUser({
        uid: uid
      })
    }
    // If error other than auth/user-not-found occurred, fail the whole login process
    throw error
  }).then(user => {
    return admin.auth().createCustomToken(user.uid, {accountId: data.accountId})
  }).then(authToken => {
    return admin.database().ref('player-pins/' + pin).remove().then(() => {
      return admin.database().ref('player-pins/' + pin).set({
        accessToken: authToken
      })
    })
  }).then(() => {
    return admin.database().ref('/accounts/' + data.accountId + '/players/' + playerId).set({
      pin: pin,
      created: context.timestamp
    })
  })
});
