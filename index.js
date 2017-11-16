'use strict';

const functions = require('firebase-functions');

const admin = require('firebase-admin');
admin.initializeApp(functions.config().firebase);

const promisePool = require('es6-promise-pool');
const PromisePool = promisePool.PromisePool;

// Maximum concurrent process.
const MAX_CONCURRENT = 3;

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

exports.updateUserAccountId = functions.database.ref('users/{userId}/accountId').onWrite(event => {
  if (!event.data.exists()) {
    return null;
  }
  const claims = {
    accountId: event.data.val()
  };
  return admin.auth().setCustomUserClaims(event.params.userId, claims).then(() => {
    return admin.database().ref('metadata/' + event.params.userId).set({
      refreshTime: event.timestamp,
      accountId: claims.accountId
    });
  });
});

exports.updateAccount = functions.database.ref('accounts/{accountId}').onUpdate(event => {
  const changed = event.data.child('title').changed() || event.data.child('users').changed();
  if (changed) {
    const accountId = event.data.key;
    const account = event.data.val() || {};

    const data = {
      title: account.title
    };
    const userIds = Object.keys(account.users || {});
    const invitationIds = Object.keys(account.invitations || {});
    if (userIds.length || invitationIds.length) {
      const promisePool = new PromisePool(() => {
        // Sync users
        if (userIds.length > 0) {
          const userId = userIds.pop();
          return admin.database().ref('/users/' + userId + '/accounts/' + accountId).set(data);
        }
        // Sync invitations
        if (invitationIds.length > 0) {
          const invitationId = invitationIds.pop();
          return admin.database().ref('/invitations/' + invitationId + '/account').update(data);
        }
      }, MAX_CONCURRENT);

      return promisePool.start();
    }

    if (userIds.length === 0) {
      return admin.database().ref('accounts/' + accountId).remove();
    }
  }
  return null;
});

exports.createInvitation = functions.database.ref('/invitations/{invitationId}').onCreate(event => {
  const invitationId = event.data.key;
  const invitation = event.data.val() || {};
  if (invitation.account && invitation.account.id) {
    return admin.database().ref('/accounts/' + invitation.account.id + '/invitations/' + invitationId).set(true);
  }
  return null;
});

exports.deleteInvitation = functions.database.ref('/invitations/{invitationId}').onDelete(event => {
  const invitationId = event.data.key;
  const invitation = event.data.val() || {};
  if (invitation.account && invitation.account.id) {
    return admin.database().ref('/accounts/' + invitation.account.id + '/invitations/' + invitationId).remove();
  }
  return null;
});

exports.acceptInvitation = functions.database.ref('/invitations/{invitationId}').onUpdate(event => {
  if (event.data.child('user').exists()) {
    const user = event.data.child('user').val();
    const accountId = event.data.child('account').child('id').val();
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

exports.updateArtworks = functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onWrite(event => {
  if (!event.data.exists()) {
    return null;
  }
  const changed = event.data.child('title').changed()
    || event.data.child('artists').changed()
    || event.data.child('shows').changed();
  if (!changed) {
    return null;
  }
  const accountId = event.params.accountId;
  const artworkId = event.data.key;
  const artwork = event.data.val() || {};
  const prevArtwork = event.data.previous.val() || {};

  const artistIds = Object.keys(artwork.artists || {});
  const showIds = Object.keys(artwork.shows || {});
  const prevArtistIds = Object.keys(prevArtwork.artists || {}).filter(val => artistIds.indexOf(val) == -1)
  const prevShowIds = Object.keys(prevArtwork.shows || {}).filter(val => showIds.indexOf(val) == -1)
  if (artistIds.length === 0 && showIds.length === 0 && prevArtistIds.length === 0 && prevShowIds.length === 0) {
    return null;
  }

  const promisePool = new PromisePool(() => {
    // Sync artists
    if (artistIds.length > 0) {
      const artistId = artistIds.pop();
      const ref = admin.database().ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId);
      return ref.update({
        title: artwork.title
      });
    }
    if (prevArtistIds.length > 0) {
      const artistId = prevArtistIds.pop();
      const path = '/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId;
      return admin.database().ref(path).remove();
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop();
      const ref = admin.database().ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId);
      return ref.update({
        title: artwork.title
      });
    }
    if (prevShowIds.length > 0) {
      const showId = prevShowIds.pop();
      const path = '/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId;
      return admin.database().ref(path).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.deleteArtwork = functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onDelete(event => {
  const accountId = event.params.accountId;
  const artworkId = event.data.key;
  const artwork = event.data.val() || {};

  const artistIds = Object.keys(artwork.artists || {});
  const showIds = Object.keys(artwork.shows || {});
  if (artistIds.length === 0 && showIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    // Sync artists
    if (artistIds.length > 0) {
      const artistId = artistIds.pop();
      const path = '/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId;
      return admin.database().ref(path).remove();
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop();
      const path = '/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId;
      return admin.database().ref(path).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.updateArtist = functions.database.ref('/accounts/{accountId}/artists/{artistId}').onUpdate(event => {
  if (!event.data.child('fullName').changed()) {
    return null;
  }
  const accountId = event.params.accountId;
  const artistId = event.data.key;
  const artist = event.data.val() || {};

  const artworkIds = Object.keys(artist.artworks || {});
  if (artworkIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      const path = '/accounts/' + accountId + '/artworks/' + artworkId + '/artists/' + artistId;
      return admin.database().ref(path).update({
        fullName: artist.fullName
      });
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.deleteArtist = functions.database.ref('/accounts/{accountId}/artists/{artistId}').onDelete(event => {
  const accountId = event.params.accountId;
  const artistId = event.data.key;
  const artist = event.data.val() || {};

  const artworkIds = Object.keys(artist.artworks || {});
  if (artworkIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      const path = '/accounts/' + accountId + '/artworks/' + artworkId + '/artists/' + artistId;
      return admin.database().ref(path).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.updateShow = functions.database.ref('/accounts/{accountId}/shows/{showId}').onUpdate(event => {
  if (!event.data.child('title').changed()) {
    return null;
  }
  const accountId = event.params.accountId;
  const showId = event.data.key;
  const show = event.data.val() || {};
  const prevShow = event.data.previous.val() || {};

  const artworkIds = Object.keys(show.artworks || {});
  const placeIds = Object.keys(show.places || {});
  const prevPlaceIds = Object.keys(prevShow.places || {}).filter(val => placeIds.indexOf(val) == -1)
  if (artworkIds.length === 0 && placeIds.length === 0 && prevPlaceIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      const path = '/accounts/' + accountId + '/artworks/' + artworkId + '/shows/' + showId;
      return admin.database().ref(path).update({
        title: show.title
      });
    }
    // Sync places
    if (placeIds.length > 0) {
      const placeId = placeIds.pop();
      const path = '/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId;
      return admin.database().ref(path).update({
        title: show.title
      });
    }
    if (prevPlaceIds.length > 0) {
      const placeId = prevPlaceIds.pop();
      const path = '/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId;
      return admin.database().ref(path).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.deleteShow = functions.database.ref('/accounts/{accountId}/shows/{showId}').onDelete(event => {
  const accountId = event.params.accountId;
  const showId = event.data.key;
  const show = event.data.val() || {};

  const artworkIds = Object.keys(show.artworks || {});
  const placeIds = Object.keys(show.places || {});
  if (artworkIds.length === 0 && placeIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      const path = '/accounts/' + accountId + '/artworks/' + artworkId + '/shows/' + showId;
      return admin.database().ref(path).remove();
    }
    // Sync places
    if (placeIds.length > 0) {
      const placeId = placeIds.pop();
      const path = '/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId;
      return admin.database().ref(path).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.updatePlace = functions.database.ref('/accounts/{accountId}/places/{placeId}').onUpdate(event => {
  if (!event.data.child('title').changed()) {
    return null;
  }
  const accountId = event.params.accountId;
  const placeId = event.data.key;
  const place = event.data.val() || {};

  const showIds = Object.keys(place.shows || {});
  if (showIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    if (showIds.length > 0) {
      const showId = showIds.pop();
      const path = '/accounts/' + accountId + '/shows/' + showId + '/places/' + placeId;
      return admin.database().ref(path).update({
        title: place.title
      });
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.deletePlace = functions.database.ref('/accounts/{accountId}/places/{placeId}').onDelete(event => {
  const accountId = event.params.accountId;
  const placeId = event.data.key;
  const place = event.data.val() || {};

  const showIds = Object.keys(place.shows || {});
  if (showIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop();
      const path = '/accounts/' + accountId + '/shows/' + showId + '/places/' + placeId;
      return admin.database().ref(path).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});
