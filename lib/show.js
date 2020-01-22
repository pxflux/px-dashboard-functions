'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const promisePool = require('es6-promise-pool');
const PromisePool = promisePool.PromisePool;

// Maximum concurrent process.
const MAX_CONCURRENT = 3;

exports.update = functions.database.ref('/accounts/{accountId}/shows/{showId}').onWrite((change, context) => {
  if (!change.after.exists()) {
    return null
  }
  const changedFn = (name, change) => {
    const beforeVal = change.before.val() || {};
    const afterVal = change.after.val() || {};
    if (beforeVal.hasOwnProperty(name) && afterVal.hasOwnProperty(name)) {
      return beforeVal[name] !== afterVal[name]
    }
    return beforeVal.hasOwnProperty(name) || afterVal.hasOwnProperty(name)
  };
  const changed = ['published', 'title', 'image', 'places'].filter(name => changedFn(name, change)).length > 0;
  if (!changed) {
    return null
  }
  const accountId = context.params.accountId;
  const showId = change.after.key;
  const show = change.after.val() || {};
  const prevShow = change.before.val() || {};

  const publicIds = show.published ? [showId] : [];
  const hideIds = show.published ? [] : [showId];
  const artworkIds = Object.keys(show.artworks || {});
  const placeIds = Object.keys(show.places || {});
  const prevPlaceIds = Object.keys(prevShow.places || {}).filter(val => placeIds.indexOf(val) == -1);
  if (publicIds.length === 0 && hideIds.length === 0 && artworkIds.length === 0 && placeIds.length === 0 && prevPlaceIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    const db = admin.database();
    if (publicIds.length > 0) {
      const publicId = publicIds.pop();
      return db.ref('/shows/' + publicId).set(show)
    }
    if (hideIds.length > 0) {
      const hideId = hideIds.pop();
      return db.ref('/shows/' + hideId).remove()
    }
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/shows/' + showId).update({
        title: show.title
      })
    }
    // Sync places
    if (placeIds.length > 0) {
      const placeId = placeIds.pop();
      return db.ref('/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId).update({
        title: show.title
      })
    }
    if (prevPlaceIds.length > 0) {
      const placeId = prevPlaceIds.pop();
      return db.ref('/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId).remove()
    }
  }, MAX_CONCURRENT);
  return promisePool.start()
});

exports.delete = functions.database.ref('/accounts/{accountId}/shows/{showId}').onDelete((snapshot, context) => {
  const accountId = context.params.accountId;
  const showId = snapshot.key;
  const show = snapshot.val() || {};

  const files = show.image ? [show.image.storageUri] : [];
  const publicIds = show.published ? [showId] : [];
  const artworkIds = Object.keys(show.artworks || {});
  const placeIds = Object.keys(show.places || {});
  if (files.length === 0 && publicIds.length === 0 && artworkIds.length === 0 && placeIds.length === 0) {
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
      return db.ref('/shows/' + publicId).remove()
    }
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/shows/' + showId).remove()
    }
    // Sync places
    if (placeIds.length > 0) {
      const placeId = placeIds.pop();
      return db.ref('/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId).remove()
    }
  }, MAX_CONCURRENT);
  return promisePool.start()
});