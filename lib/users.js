'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

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
