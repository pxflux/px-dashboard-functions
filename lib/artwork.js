'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const promisePool = require('es6-promise-pool');
const PromisePool = promisePool.PromisePool;

// Maximum concurrent process.
const MAX_CONCURRENT = 3;

exports.update = functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onWrite((change, context) => {
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
  const changed = ['published', 'url', 'title', 'description', 'year', 'vimeoId', 'artists', 'shows', 'controls'].filter(name => changedFn(name, change)).length > 0;
  if (!changed) {
    return null
  }
  const accountId = context.params.accountId;
  const artworkId = change.after.key;
  const artwork = change.after.val() || {};
  const prevArtwork = change.before.val() || {};

  const publicIds = artwork.published ? [artworkId] : [];
  const hideIds = artwork.published ? [] : [artworkId];
  const artistIds = Object.keys(artwork.artists || {});
  const showIds = Object.keys(artwork.shows || {});
  const prevArtistIds = Object.keys(prevArtwork.artists || {}).filter(val => artistIds.indexOf(val) === -1);
  const prevShowIds = Object.keys(prevArtwork.shows || {}).filter(val => showIds.indexOf(val) === -1);
  if (publicIds.length === 0 && hideIds.length === 0 && artistIds.length === 0 && showIds.length === 0 && prevArtistIds.length === 0 && prevShowIds.length === 0) {
    return null
  }

  const promisePool = new PromisePool(() => {
    const db = admin.database();
    if (publicIds.length > 0) {
      delete artwork['published'];
      const publicId = publicIds.pop();
      return db.ref('/artworks/' + publicId).set(artwork)
    }
    if (hideIds.length > 0) {
      const hideId = hideIds.pop();
      return db.ref('/artworks/' + hideId).remove()
    }
    // Sync artists
    if (artistIds.length > 0) {
      const artistId = artistIds.pop();
      return db.ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId).update({
        title: artwork.title
      })
    }
    if (prevArtistIds.length > 0) {
      const artistId = prevArtistIds.pop();
      return db.ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId).remove()
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop();
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId).update({
        title: artwork.title
      })
    }
    if (prevShowIds.length > 0) {
      const showId = prevShowIds.pop();
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId).remove()
    }
  }, MAX_CONCURRENT);
  return promisePool.start()
});

exports.delete = functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onDelete((snapshot, context) => {
  const accountId = context.params.accountId;
  const artworkId = snapshot.key;
  const artwork = snapshot.val() || {};

  const files = artwork.image ? [artwork.image.storageUri] : [];
  const publicIds = artwork.published ? [artworkId] : [];
  const artistIds = Object.keys(artwork.artists || {});
  const showIds = Object.keys(artwork.shows || {});
  if (files.length === 0 && publicIds.length === 0 && artistIds.length === 0 && showIds.length === 0) {
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
      return db.ref('/artworks/' + publicId).remove()
    }
    // Sync artists
    if (artistIds.length > 0) {
      const artistId = artistIds.pop();
      return db.ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId).remove()
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop();
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId).remove()
    }
  }, MAX_CONCURRENT);
  return promisePool.start()
});
