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

exports.updateArtworkPublished = functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onUpdate(event => {
  if (!event.data.child('published').changed()) {
    return null;
  }
  const accountId = event.params.accountId;
  const artworkId = event.data.key;
  const artwork = event.data.val() || {};
  const ref = admin.database().ref('/artworks/' + artworkId);
  if (artwork.published) {
    delete artwork['published']
    return ref.set(artwork)
  } else {
    return ref.remove()
  }
});

exports.updateArtworks = functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onWrite(event => {
  if (!event.data.exists()) {
    return null;
  }
  const changed = ['title', 'artists', 'shows'].filter(name => event.data.child(name).changed()).length > 0
  if (!changed) {
    return null;
  }
  if (!changed) {
    return null;
  }
  const accountId = event.params.accountId;
  const artworkId = event.data.key;
  const artwork = event.data.val() || {};
  const prevArtwork = event.data.previous.val() || {};

  const publicIds = artwork.published ? [artworkId] : [];
  const artistIds = Object.keys(artwork.artists || {});
  const showIds = Object.keys(artwork.shows || {});
  const prevArtistIds = Object.keys(prevArtwork.artists || {}).filter(val => artistIds.indexOf(val) == -1)
  const prevShowIds = Object.keys(prevArtwork.shows || {}).filter(val => showIds.indexOf(val) == -1)
  if (artistIds.length === 0 && showIds.length === 0 && prevArtistIds.length === 0 && prevShowIds.length === 0) {
    return null;
  }

  const promisePool = new PromisePool(() => {
    const db = admin.database();
    if (publicIds.length > 0) {
      delete artwork['published'];
      const publicId = publicIds.pop();
      return db.ref('/artworks/' + publicId).set(artwork);
    }
    // Sync artists
    if (artistIds.length > 0) {
      const artistId = artistIds.pop();
      return db.ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId).update({
        title: artwork.title
      });
    }
    if (prevArtistIds.length > 0) {
      const artistId = prevArtistIds.pop();
      return db.ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId).remove();
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop();
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId).update({
        title: artwork.title
      });
    }
    if (prevShowIds.length > 0) {
      const showId = prevShowIds.pop();
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.deleteArtwork = functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onDelete(event => {
  const accountId = event.params.accountId;
  const artworkId = event.data.key;
  const artwork = event.data.val() || {};

  const files = artwork.image ? [artwork.image.storageUri] : [];
  const publicIds = artwork.published ? [artworkId] : [];
  const artistIds = Object.keys(artwork.artists || {});
  const showIds = Object.keys(artwork.shows || {});
  if (artistIds.length === 0 && showIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    if (files.length > 0) {
      const file = files.pop();
      return admin.storage().refFromURL(file).delete();
    }
    const db = admin.database();
    if (publicIds.length > 0) {
      const publicId = publicIds.pop();
      return db.ref('/artworks/' + publicId).remove();
    }
    // Sync artists
    if (artistIds.length > 0) {
      const artistId = artistIds.pop();
      return db.ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId).remove();
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop();
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.updateArtistPublished = functions.database.ref('/accounts/{accountId}/artists/{artistId}').onUpdate(event => {
  if (!event.data.child('published').changed()) {
    return null;
  }
  const accountId = event.params.accountId;
  const artistId = event.data.key;
  const artist = event.data.val() || {};
  const ref = admin.database().ref('/artists/' + artistId);
  if (artist.published) {
    delete artist['published']
    return ref.set(artist)
  } else {
    return ref.remove()
  }
});

exports.updateArtist = functions.database.ref('/accounts/{accountId}/artists/{artistId}').onUpdate(event => {
  const changed = ['fullName', 'image'].filter(name => event.data.child(name).changed()).length > 0
  if (!changed) {
    return null;
  }
  const accountId = event.params.accountId;
  const artistId = event.data.key;
  const artist = event.data.val() || {};

  const publicIds = artist.published ? [artistId] : [];
  const artworkIds = Object.keys(artist.artworks || {});
  if (artworkIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    const db = admin.database();
    if (publicIds.length > 0) {
      delete artist['published'];
      const publicId = publicIds.pop();
      return db.ref('/artists/' + publicId).set(artist);
    }
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/artists/' + artistId).update({
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

  const files = artist.image ? [artist.image.storageUri] : [];
  const publicIds = artist.published ? [artistId] : [];
  const artworkIds = Object.keys(artist.artworks || {});
  if (artworkIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    if (files.length > 0) {
      const file = files.pop();
      return admin.storage().refFromURL(file).delete();
    }
    const db = admin.database();
    if (publicIds.length > 0) {
      const publicId = publicIds.pop();
      return db.ref('/artists/' + publicId).remove();
    }
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/artists/' + artistId).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.updateShowPublished = functions.database.ref('/accounts/{accountId}/shows/{showId}').onUpdate(event => {
  if (!event.data.child('published').changed()) {
    return null;
  }
  const accountId = event.params.accountId;
  const showId = event.data.key;
  const show = event.data.val() || {};
  const ref = admin.database().ref('/shows/' + showId);
  if (show.published) {
    delete show['published']
    return ref.set(show)
  } else {
    return ref.remove()
  }
});

exports.updateShow = functions.database.ref('/accounts/{accountId}/shows/{showId}').onUpdate(event => {
  const changed = ['title', 'image', 'places'].filter(name => event.data.child(name).changed()).length > 0
  if (!changed) {
    return null;
  }
  const accountId = event.params.accountId;
  const showId = event.data.key;
  const show = event.data.val() || {};
  const prevShow = event.data.previous.val() || {};

  const publicIds = show.published ? [showId] : [];
  const artworkIds = Object.keys(show.artworks || {});
  const placeIds = Object.keys(show.places || {});
  const prevPlaceIds = Object.keys(prevShow.places || {}).filter(val => placeIds.indexOf(val) == -1)
  if (artworkIds.length === 0 && placeIds.length === 0 && prevPlaceIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    const db = admin.database();
    if (publicIds.length > 0) {
      delete show['published'];
      const publicId = publicIds.pop();
      return db.ref('/shows/' + publicId).set(show);
    }
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/shows/' + showId).update({
        title: show.title
      });
    }
    // Sync places
    if (placeIds.length > 0) {
      const placeId = placeIds.pop();
      return db.ref('/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId).update({
        title: show.title
      });
    }
    if (prevPlaceIds.length > 0) {
      const placeId = prevPlaceIds.pop();
      return db.ref('/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.deleteShow = functions.database.ref('/accounts/{accountId}/shows/{showId}').onDelete(event => {
  const accountId = event.params.accountId;
  const showId = event.data.key;
  const show = event.data.val() || {};

  const files = show.image ? [show.image.storageUri] : [];
  const publicIds = show.published ? [showId] : [];
  const artworkIds = Object.keys(show.artworks || {});
  const placeIds = Object.keys(show.places || {});
  if (files.length === 0 && publicIds.length === 0 && artworkIds.length === 0 && placeIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    if (files.length > 0) {
      const file = files.pop();
      return admin.storage().refFromURL(file).delete();
    }
    const db = admin.database();
    if (publicIds.length > 0) {
      const publicId = publicIds.pop();
      return db.ref('/shows/' + publicId).remove();
    }
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop();
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/shows/' + showId).remove();
    }
    // Sync places
    if (placeIds.length > 0) {
      const placeId = placeIds.pop();
      return db.ref('/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});

exports.updatePlace = functions.database.ref('/accounts/{accountId}/places/{placeId}').onUpdate(event => {
  const changed = event.data.child('published').changed() || event.data.child('title').changed() || event.data.child('image').changed()
  if (!changed) {
    return null;
  }
  const accountId = event.params.accountId;
  const placeId = event.data.key;
  const place = event.data.val() || {};

  const publicIds = place.published ? [placeId] : [];
  const hideIds = place.published ? [] : [placeId];
  const showIds = Object.keys(place.shows || {});
  if (publicIds.length === 0 && hideIds.length === 0 && showIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    const db = admin.database();
    if (publicIds.length > 0) {
      const publicId = publicIds.pop();
      return db.ref('/places/' + publicId).set(place);
    }
    if (hideIds.length > 0) {
      const hideId = hideIds.pop();
      return db.ref('/places/' + hideId).remove();
    }
    if (showIds.length > 0) {
      const showId = showIds.pop();
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/places/' + placeId).update({
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

  const files = place.image ? [place.image.storageUri] : [];
  const publicIds = place.published ? [placeId] : [];
  const showIds = Object.keys(place.shows || {});
  if (files.length === 0 && publicIds.length === 0 && showIds.length === 0) {
    return null;
  }
  const promisePool = new PromisePool(() => {
    if (files.length > 0) {
      const file = files.pop();
      return admin.storage().refFromURL(file).delete();
    }
    const db = admin.database();
    if (publicIds.length > 0) {
      const publicId = publicIds.pop();
      return db.ref('/places/' + publicId).remove();
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop();
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/places/' + placeId).remove();
    }
  }, MAX_CONCURRENT);
  return promisePool.start();
});
