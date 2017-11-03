'use strict';

const functions = require('firebase-functions');

const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const promisePool = require('es6-promise-pool');
const PromisePool = promisePool.PromisePool;

// Maximum concurrent process.
const MAX_CONCURRENT = 3;

exports.updateActors = functions.database.ref('/actors/{actorId}/').onWrite(event => {
  const deleted = !event.data.exists();
  const changed = event.data.child('fullName').changed();
  if (deleted || changed) {
    const actorId = event.data.key;
    const actor = event.data.val() || {};
    const artworksIds = Object.keys(actor.artworks || {});
    if (artworksIds.length) {
      const promisePool = new PromisePool(() => {
        if (artworksIds.length > 0) {
          const artworkId = artworksIds.pop();
          const artwork = actor.artworks[artworkId];
          const path = '/users/' + artwork.ownerId + '/artworks/' + artworkId + '/actors/' + actorId;
          if (changed) {
            return admin.database().ref(path).update({
              fullName: actor.fullName,
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
