'use strict';

const functions = require('firebase-functions');
const admin = require('./firebase');

exports.delete = functions.database.ref('users/{userId}').onDelete(snapshot => {
  const userId = snapshot.key;
  const user = snapshot.val() || {};

  const updates = {};
  Object.keys(user.accounts || {}).forEach(accountId => {
    updates[`/accounts/${accountId}/users/${userId}`] = null
  });
  if (Object.keys(updates).length === 0) {
    return null
  }
  return admin.database().ref().update(updates)
});

exports.update = functions.database.ref('users/{userId}/accountId').onWrite(async (change, context) => {
  if (!change.after.exists()) {
    return null
  }
  const userId = context.params.userId;
  const accountId = change.after.val();
  await admin.auth().setCustomUserClaims(userId, {
    accountId
  });
  return admin.database().ref(`metadata/${userId}`).set({
    refreshTime: context.timestamp,
    accountId
  })
});

exports.account = functions.https.onCall(async ({accountId}, {auth, timestamp}) => {
  if (!auth) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
  }
  if (auth.token.accountId === accountId) {
    return;
  }
  try {
    await admin.auth().setCustomUserClaims(auth.uid, {accountId});
    await admin.database().ref(`metadata/${auth.uid}`).set({refreshTime: new Date().getTime()})
  } catch (e) {
    throw new functions.https.HttpsError('unknown', e.message, e);
  }
});
