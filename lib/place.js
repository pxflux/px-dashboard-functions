'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const changedFn = require('./changed-fn');

const promisePool = require('es6-promise-pool');
const PromisePool = promisePool.PromisePool;

// Maximum concurrent process.
const MAX_CONCURRENT = 3;

exports.update = functions.database.ref('/accounts/{accountId}/places/{placeId}').onUpdate((change, context) => {
  const changed = ['published', 'title', 'image'].filter(name => changedFn(name, change)).length > 0;
  if (!changed) {
    return null
  }
  const accountId = context.params.accountId;
  const placeId = context.params.placeId;
  const place = change.after.val() || {};

  const publicIds = place.published ? [placeId] : [];
  const hideIds = place.published ? [] : [placeId];
  const showIds = Object.keys(place.shows || {});
  if (publicIds.length === 0 && hideIds.length === 0 && showIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    const db = admin.database();
    if (publicIds.length > 0) {
      const publicId = publicIds.pop();
      return db.ref(`/places/${publicId}`).set(place)
    }
    if (hideIds.length > 0) {
      const hideId = hideIds.pop();
      return db.ref(`/places/${hideId}`).remove()
    }
    if (showIds.length > 0) {
      const showId = showIds.pop();
      return db.ref(`/accounts/${accountId}/shows/${showId}/places/${placeId}`).update({
        title: place.title
      })
    }
  }, MAX_CONCURRENT);
  return promisePool.start()
});

exports.delete = functions.database.ref('/accounts/{accountId}/places/{placeId}').onDelete((snapshot, context) => {
  const accountId = context.params.accountId;
  const placeId = snapshot.key;
  const place = snapshot.val() || {};

  const files = place.image ? [place.image.storageUri] : [];
  const publicIds = place.published ? [placeId] : [];
  const showIds = Object.keys(place.shows || {});
  if (files.length === 0 && publicIds.length === 0 && showIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    if (files.length > 0) {
      const file = files.pop();
      return admin.storage().refFromURL(file).delete()
    }
    const db = admin.database();
    if (publicIds.length > 0) {
      const publicId = publicIds.pop();
      return db.ref(`/places/${publicId}`).remove()
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop();
      return db.ref(`/accounts/${accountId}/shows/${showId}/places/${placeId}`).remove()
    }
  }, MAX_CONCURRENT);
  return promisePool.start()
});
