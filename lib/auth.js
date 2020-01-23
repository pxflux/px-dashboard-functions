'use strict';

const functions = require('firebase-functions');
const admin = require('./firebase');

exports.create = functions.auth.user().onCreate(async ({displayName, photoURL, uid}, context) => {
  if (uid.startsWith('player:')) {
    return null
  }
  const db = admin.database();
  const accountId = db.ref('accounts').push().key;

  const updates = {};
  updates[`accounts/${accountId}/account/title`] = 'Untitled team';
  updates[`accounts/${accountId}/users/${uid}/displayName`] = displayName;
  updates[`accounts/${accountId}/users/${uid}/photoUrl`] = photoURL;
  updates[`accounts/${accountId}/users/${uid}/ts`] = context.timestamp;
  updates[`users/${uid}/accounts/${accountId}/title`] = 'Untitled team';
  await db.ref().update(updates);

  await admin.auth().setCustomUserClaims(uid, {accountId});
  return db.ref('/metadata/' + uid).set({refreshTime: context.timestamp})
});

exports.delete = functions.auth.user().onDelete(async ({uid}) => {
  if (uid.startsWith('player:')) {
    return null
  }
  const updates = {};
  updates[`/users/${uid}`] = null;
  updates[`/metadata/${uid}`] = null;
  return admin.database().ref().update(updates)
});
