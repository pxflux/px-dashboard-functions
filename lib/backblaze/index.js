const functions = require('firebase-functions');
const admin = require('../firebase');
const authorize = require('./client');

async function setup(accountId) {
  const ref = admin.database().ref(`backblaze/${accountId}`);
  const snap = await ref.once('value');
  if (snap.exists()) {
    return snap.val();
  }
  const {key_id, application_key} = functions.config().backblaze;
  const client = await authorize(key_id, application_key);
  const bucketName = 'pxflux-' + accountId.toLowerCase().replace(/[^0-9a-z]/gi, '-');
  const {bucketId} = await client.createBucket(bucketName);
  const {applicationKeyId: id, applicationKey: secret} = await client.createKey(bucketName, bucketId);
  await ref.set({id, secret, bucketId});
  return {id, secret, bucketId};
}

exports.uploadurl = functions.https.onCall(async (_, {auth}) => {
  if (!auth) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
  }
  try {
    const {id, secret, bucketId} = await setup(auth.token.accountId);
    const client = await authorize(id, secret);
    return client.getUploadUrl(bucketId);
  } catch (e) {
    throw new functions.https.HttpsError('unknown', e.message, e);
  }
});

exports.downloadurl = functions.https.onCall(async (_, {auth}) => {
  if (!auth) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
  }
  try {
    const {id, secret, bucketId} = await setup(auth.token.accountId);
    const client = await authorize(id, secret);
    return client.getUploadUrl(bucketId);
  } catch (e) {
    throw new functions.https.HttpsError('unknown', e.message, e);
  }
});
