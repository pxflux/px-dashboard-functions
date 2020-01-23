'use strict';

const functions = require('firebase-functions');
const admin = require('./firebase');
const changedFn = require('./changed-fn');

const promisePool = require('es6-promise-pool');
const PromisePool = promisePool.PromisePool;

// Maximum concurrent process.
const MAX_CONCURRENT = 3;

exports.update = functions.database.ref('/accounts/{accountId}/artists/{artistId}').onUpdate((change, context) => {
  const changed = ['published', 'fullName', 'image', 'artworks'].filter(name => changedFn(name, change)).length > 0;
  if (!changed) {
    return null
  }
  const accountId = context.params.accountId;
  const artistId = change.after.key;
  const artist = change.after.val() || {};

  const publicIds = artist.published ? [artistId] : [];
  const hideIds = artist.published ? [] : [artistId];
  const artworkIds = Object.keys(artist.artworks || {});
  if (publicIds.length === 0 && hideIds.length === 0 && artworkIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    const db = admin.database();
    if (publicIds.length > 0) {
      const publicId = publicIds.pop();
      return db.ref('/artists/' + publicId).set(artist)
    }
    if (hideIds.length > 0) {
      const hideId = hideIds.pop();
      return db.ref('/artists/' + hideId).remove()
    }
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/artists/' + artistId).update({
        fullName: artist.fullName
      })
    }
    return Promise.resolve()
  }, MAX_CONCURRENT);
  return promisePool.start()
});

exports.delete = functions.database.ref('/accounts/{accountId}/artists/{artistId}').onDelete((snapshot, context) => {
  const accountId = context.params.accountId;
  const artistId = snapshot.key;
  const artist = snapshot.val() || {};

  const files = artist.image ? [artist.image.storageUri] : [];
  const publicIds = artist.published ? [artistId] : [];
  const artworkIds = Object.keys(artist.artworks || {});
  if (files.length === 0 && publicIds.length === 0 && artworkIds.length === 0) {
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
      return db.ref(`/artists/${publicId}`).remove()
    }
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      return db.ref(`/accounts/${accountId}/artworks/${artworkId}/artists/${artistId}`).remove()
    }
    return Promise.resolve()
  }, MAX_CONCURRENT);
  return promisePool.start()
});
