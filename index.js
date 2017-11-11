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
          const ref = admin.database().ref('/users/' + artwork.ownerId + '/artworks/' + artworkId + '/artists/' + artistId);
          if (changed) {
            return ref.update({
              fullName: artist.fullName,
              lastmodified: event.timestamp
            }).catch(error => {
              console.error('Update artwork', artworkId, 'failed:', error);
            });
          } else if (deleted) {
            return ref.remove().catch(error => {
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
  const changed = event.data.child('title').changed() || event.data.child('artists').changed();
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
              console.error('Add artwork to artist', artistId, 'failed:', error);
            });
          } else if (deleted) {
            return ref.remove().catch(error => {
              console.error('Remove artwork from artist', artistId, 'failed:', error);
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

exports.createAccount = functions.auth.user().onCreate(event => {
  const user = event.data;
  const db = admin.database();
  const account = {
    'title': user.displayName,
    'users': {}
  };
  account['users'][user.uid] = true;
  return db.ref("accounts").push(account).then(function (data) {
    const accountId = data.key;
    return db.ref('users/' + user.uid + '/accounts/' + accountId).set({'title': user.displayName}).then(function () {
      const claims = {
        accountId: accountId
      };
      return admin.auth().setCustomUserClaims(user.uid, claims).then(() => {
        const metadata = {
          refreshTime: event.timestamp
        };
        return db.ref('metadata/' + user.uid).set(metadata);
      });
    });
  });
});

exports.wipeoutUser = functions.auth.user().onDelete(event => {
  const uid = event.data.uid;
  return Promise.all([
    admin.database().ref('/users/' + uid).once('value').then(function (res) {
      if (!res.exists()) {
        return null;
      }
      const user = res.val() || {};
      const accountIds = Object.keys(user.accounts || {});
      if (accountIds.length) {
        const promisePool = new PromisePool(() => {
          if (accountIds.length > 0) {
            const accountId = accountIds.pop();
            return admin.database().ref('/accounts/' + accountId + '/users/' + uid).remove();
          }
        }, MAX_CONCURRENT);
        return promisePool.start();
      }
    }),
    admin.database().ref('/metadata/' + uid).remove()
  ]);
});

exports.acceptInvitation = functions.database.ref('/invitations/{invitationId}').onUpdate(event => {
  if (event.data.child('uid').exists()) {
    const uid = event.data.child('uid').val();
    const accountId = event.data.child('accountId').val();
    return admin.database().ref('/invitations/' + event.data.key).remove().then(function () {
      const claims = {
        accountId: accountId
      };
      return admin.auth().setCustomUserClaims(uid, claims).then(() => {
        const metadata = {
          refreshTime: event.timestamp
        };
        return db.ref('metadata/' + user.uid).set(metadata);
      });
    });
  }
  return null;
});
