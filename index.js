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

exports.createAuth = functions.auth.user().onCreate(event => {
  const user = event.data;
  const db = admin.database();
  const account = {
    'title': 'Untitled team',
    'users': {}
  };
  account['users'][user.uid] = {
    'displayName': user.displayName,
    'photoUrl': user.photoURL
  };
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

exports.deleteAuth = functions.auth.user().onDelete(event => {
  const uid = event.data.uid;
  return Promise.all([
    admin.database().ref('/users/' + uid).remove(),
    admin.database().ref('/metadata/' + uid).remove()
  ])
});

exports.deleteUser = functions.database.ref('users/{userId}').onDelete(event => {
  const userId = event.data.key;
  const user = event.data.val() || {};

  // Sync accounts
  const accountIds = Object.keys(user.accounts || {});
  if (accountIds.length) {
    const promisePool = new PromisePool(() => {
      if (accountIds.length > 0) {
        const accountId = accountIds.pop();
        return admin.database().ref('/accounts/' + accountId + '/users/' + userId).remove();
      }
    }, MAX_CONCURRENT);

    return promisePool.start().catch(error => {
      console.error('Update accounts failed:', error);
    });
  }
  return null;
});

exports.updateUserAccountId = functions.database.ref('users/{userId}/accountId').onUpdate(event => {
  const claims = {
    accountId: event.data.val()
  };
  return admin.auth().setCustomUserClaims(event.params.userId, claims).then(() => {
    return admin.database().ref('metadata/' + event.params.userId).set({refreshTime: event.timestamp});
  });
});

exports.updateAccount = functions.database.ref('accounts/{accountId}').onUpdate(event => {
  const changed = event.data.child('title').changed() || event.data.child('users').changed();
  if (changed) {
    const accountId = event.data.key;
    const account = event.data.val() || {};

    // Sync users
    const userIds = Object.keys(account.users || {});
    if (userIds.length) {
      const promisePool = new PromisePool(() => {
        if (userIds.length > 0) {
          const userId = userIds.pop();
          return admin.database().ref('/users/' + userId + '/accounts/' + accountId).set({
            title: account.title
          });
        }
      }, MAX_CONCURRENT);

      return promisePool.start().catch(error => {
        console.error('Update account failed:', error);
      });
    } else {
      return admin.database().ref('accounts/' + accountId).remove().catch(error => {
        console.error('Remove account failed:', error);
      });
    }
  }
  return null;
});

exports.acceptInvitation = functions.database.ref('/invitations/{invitationId}').onUpdate(event => {
  if (event.data.child('user').exists()) {
    const user = event.data.child('user').val();
    const accountId = event.data.child('accountId').val();
    return admin.database().ref('/invitations/' + event.data.key).remove().then(function () {
      const data = {
        'displayName': user.displayName,
        'photoUrl': user.photoUrl
      };
      return admin.database().ref('accounts/' + accountId + '/users/' + user.uid).set(data);
    });
  }
  return null;
});
