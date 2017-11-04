'use strict';

const functions = require('firebase-functions');

const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const promisePool = require('es6-promise-pool');
const PromisePool = promisePool.PromisePool;

// Maximum concurrent process.
const MAX_CONCURRENT = 3;

exports.updateArtists = functions.database.ref('/artists/{artistId}/').onWrite(event => {
  const deleted = !event.data.exists();
  const changed = event.data.child('fullName').changed();
  if (deleted || changed) {
    const artistId = event.data.key;
    const artist = event.data.val() || {};
    const artworksIds = Object.keys(artist.artworks || {});
    if (artworksIds.length) {
      const promisePool = new PromisePool(() => {
        if (artworksIds.length > 0) {
          const artworkId = artworksIds.pop();
          const artwork = artist.artworks[artworkId];
          const path = '/users/' + artwork.ownerId + '/artworks/' + artworkId + '/artists/' + artistId;
          if (changed) {
            return admin.database().ref(path).update({
              fullName: artist.fullName,
              lastmodified: event.timestamp
            }).catch(error => {
              console.error('Update artwork', artworkId, 'failed:', error);
            });
          } else if (deleted) {
            return admin.database().ref(path).remove().catch(error => {
              console.error('Remove artwork', artworkId, 'failed:', error);
            });
          } else {
            return Promise.resolve();
          }
        }
      }, MAX_CONCURRENT);

      return promisePool.start().catch(error => {
        console.error('Update artworks failed:', error);
      });
    }
  }
  return null;
});

exports.updateArtworks = functions.database.ref('/users/{userId}/artworks/{artworkId}/').onWrite(event => {
  const deleted = !event.data.exists();
  const changed = event.data.child('title').changed();
  if (deleted || changed) {
    const userId = event.params.userId;
    const artworkId = event.data.key;
    const artwork = event.data.val() || {};

    // Sync artists
    const artistsIds = Object.keys(artwork.artists || {});
    if (artistsIds.length) {
      const promisePool = new PromisePool(() => {
        if (artistsIds.length > 0) {
          const artistId = artistsIds.pop();
          const ref = admin.database().ref('/artists/' + artistId + '/artworks/' + artworkId);
          if (changed) {
            return ref.set({
              ownerId: userId,
              title: artwork.title,
              lastmodified: event.timestamp
            }).catch(error => {
              console.error('Update artist', artistId, 'failed:', error);
            });
          } else if (deleted) {
            return ref.remove().catch(error => {
              console.error('Remove artist', artistId, 'failed:', error);
            });
          } else {
            return Promise.resolve();
          }
        }
      }, MAX_CONCURRENT);

      return promisePool.start().catch(error => {
        console.error('Update artists failed:', error);
      });
    }
  }
  return null;
});
