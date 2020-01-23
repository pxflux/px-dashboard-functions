'use strict';

const functions = require('firebase-functions');
const admin = require('./firebase');
const crypto = require('crypto');

exports.update = functions.database.ref('player-pins/{pin}').onCreate(async (snapshot, context) => {
  const pin = context.params.pin;
  const {accessToken, accountId} = snapshot.val() || {};
  if (accessToken || !accountId) {
    return null
  }
  const playerId = crypto.randomBytes(20).toString('hex');
  const uid = `player:${playerId}`;
  let user;
  try {
    user = await admin.auth().getUser(uid);
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      // If error other than auth/user-not-found occurred, fail the whole login process
      throw error
    }
    user = await admin.auth().createUser({uid})
  }
  const authToken = await admin.auth().createCustomToken(user.uid, {accountId});

  await admin.database().ref(`player-pins/${pin}`).remove();
  await admin.database().ref(`player-pins/${pin}`).set({
    accessToken: authToken
  });
  return admin.database().ref(`/accounts/${accountId}/players/${playerId}`).set({
    pin,
    created: context.timestamp
  });
});
