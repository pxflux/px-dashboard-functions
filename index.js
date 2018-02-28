'use strict'

const functions = require('firebase-functions')

const admin = require('firebase-admin')
const serviceAccount = require('./service-account.json')
admin.initializeApp(Object.assign({}, functions.config().firebase, {
  credential: admin.credential.cert(serviceAccount)
}))

const promisePool = require('es6-promise-pool')
const PromisePool = promisePool.PromisePool
const crypto = require('crypto')

// Maximum concurrent process.
const MAX_CONCURRENT = 3

exports.createAuth = functions.auth.user().onCreate(event => {
  const user = event.data
  if (user.uid.startsWith('player:')) {
    return null
  }
  const db = admin.database()
  const account = {
    'title': 'Untitled team',
    'users': {}
  }
  account['users'][user.uid] = {
    'displayName': user.displayName,
    'photoUrl': user.photoURL
  }
  return db.ref('accounts').push(account).then(function (snapshot) {
    const accountId = snapshot.key
    return db.ref('users/' + user.uid + '/accounts/' + accountId).set({'title': account.title}).then(function () {
      const claims = {
        accountId: accountId
      }
      return admin.auth().setCustomUserClaims(user.uid, claims).then(() => {
        return db.ref('metadata/' + user.uid).set({refreshTime: event.timestamp})
      })
    })
  })
})

exports.deleteAuth = functions.auth.user().onDelete(event => {
  const uid = event.data.uid
  if (uid.startsWith('player:')) {
    return null
  }
  const updates = {}
  updates['/users/' + uid] = null
  updates['/metadata/' + uid] = null
  return admin.database().ref().update(updates)
})

exports.deleteUser = functions.database.ref('users/{userId}').onDelete(event => {
  const userId = event.data.key
  const user = event.data.previous.val() || {}

  const updates = {}
  Object.keys(user.accounts || {}).forEach(accountId => {
    updates['/accounts/' + accountId + '/users/' + userId] = null
  })
  if (Object.keys(updates).length === 0) {
    return null
  }
  return admin.database().ref().update(updates)
})

exports.updateUserAccountId = functions.database.ref('users/{userId}/accountId').onWrite(event => {
  if (!event.data.exists()) {
    return null
  }
  const claims = {
    accountId: event.data.val()
  }
  return admin.auth().setCustomUserClaims(event.params.userId, claims).then(() => {
    return admin.database().ref('metadata/' + event.params.userId).set({
      refreshTime: event.timestamp,
      accountId: claims.accountId
    })
  })
})

exports.updateAccount = functions.database.ref('accounts/{accountId}').onUpdate(event => {
  const accountId = event.data.key
  const previous = event.data.previous.val() || {}
  const account = event.data.val() || {}

  const updates = {}
  if (Object.keys(account.users || {}).length === 0) {
    updates['accounts/' + accountId] = null
  } else {
    // Sync users
    const userIds = {}
    if (event.data.child('users').changed()) {
      // Delete removed
      Object.keys(previous.users || {}).forEach(userId => userIds[userId] = null)
      Object.keys(account.users || {}).forEach(userId => delete userIds[userId])
      // Add new
    }
    Object.keys(account.users || {}).forEach(userId => userIds[userId] = {title: account.title})
    console.log('userIds')
    console.log(previous.users || {})
    console.log(account.users || {})
    console.log(userIds)

    // Sync invitations
    const invitationIds = {}
    if (event.data.child('invitations').changed()) {
      Object.keys(previous.invitations || {}).forEach(invitationId => invitationIds[invitationId] = null)
      Object.keys(account.invitations || {}).forEach(invitationId => delete invitationIds[invitationId])
    }

    if (event.data.child('title').changed()) {
      // Sync users
      Object.keys(account.users || {}).forEach(userId => {
        userIds[userId] = {title: account.title}
      })
      // Sync invitations
      Object.keys(account.invitations || {}).forEach(invitationId => {
        invitationIds[invitationId] = {title: account.title}
      })
    }

    Object.keys(userIds).forEach(userId => {
      updates['/users/' + userId + '/accounts/' + accountId] = userIds[userId]
    })
    Object.keys(invitationIds).forEach(invitationId => {
      updates['/invitations/' + invitationId + '/accounts/' + accountId] = invitationIds[invitationId]
    })
  }
  console.log(updates)

  if (Object.keys(updates).length === 0) {
    return null
  }
  return admin.database().ref().update(updates)
})

exports.createInvitation = functions.database.ref('/invitations/{invitationId}').onCreate(event => {
  const invitationId = event.data.key
  const invitation = event.data.val() || {}
  if (invitation.account && invitation.account.id) {
    return admin.database().ref('/accounts/' + invitation.account.id + '/invitations/' + invitationId).set(true)
  }
  return null
})

exports.deleteInvitation = functions.database.ref('/invitations/{invitationId}').onDelete(event => {
  const invitationId = event.data.key
  const invitation = event.data.previous.val() || {}
  if (invitation.account && invitation.account.id) {
    return admin.database().ref('/accounts/' + invitation.account.id + '/invitations/' + invitationId).remove()
  }
  return null
})

exports.acceptInvitation = functions.database.ref('/invitations/{invitationId}').onUpdate(event => {
  if (event.data.child('user').exists()) {
    const user = event.data.child('user').val()
    const accountId = event.data.child('account').child('id').val()
    return admin.database().ref('/invitations/' + event.data.key).remove().then(function () {
      const data = {
        'displayName': user.displayName,
        'photoUrl': user.photoUrl
      }
      return admin.database().ref('accounts/' + accountId + '/users/' + user.uid).set(data)
    })
  }
  return null
})

exports.updateArtworks = functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onWrite(event => {
  if (!event.data.exists()) {
    return null
  }
  const changed = ['published', 'url', 'title', 'description', 'year', 'vimeoId', 'artists', 'shows', 'controls'].filter(name => event.data.child(name).changed()).length > 0
  if (!changed) {
    return null
  }
  if (!changed) {
    return null
  }
  const accountId = event.params.accountId
  const artworkId = event.data.key
  const artwork = event.data.val() || {}
  const prevArtwork = event.data.previous.val() || {}

  const publicIds = artwork.published ? [artworkId] : []
  const hideIds = artwork.published ? [] : [artworkId]
  const artistIds = Object.keys(artwork.artists || {})
  const showIds = Object.keys(artwork.shows || {})
  const prevArtistIds = Object.keys(prevArtwork.artists || {}).filter(val => artistIds.indexOf(val) == -1)
  const prevShowIds = Object.keys(prevArtwork.shows || {}).filter(val => showIds.indexOf(val) == -1)
  if (publicIds.length === 0 && hideIds.length === 0 && artistIds.length === 0 && showIds.length === 0 && prevArtistIds.length === 0 && prevShowIds.length === 0) {
    return null
  }

  const promisePool = new PromisePool(() => {
    const db = admin.database()
    if (publicIds.length > 0) {
      delete artwork['published']
      const publicId = publicIds.pop()
      return db.ref('/artworks/' + publicId).set(artwork)
    }
    if (hideIds.length > 0) {
      const hideId = hideIds.pop()
      return db.ref('/artworks/' + hideId).remove()
    }
    // Sync artists
    if (artistIds.length > 0) {
      const artistId = artistIds.pop()
      return db.ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId).update({
        title: artwork.title
      })
    }
    if (prevArtistIds.length > 0) {
      const artistId = prevArtistIds.pop()
      return db.ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId).remove()
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop()
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId).update({
        title: artwork.title
      })
    }
    if (prevShowIds.length > 0) {
      const showId = prevShowIds.pop()
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId).remove()
    }
  }, MAX_CONCURRENT)
  return promisePool.start()
})

exports.deleteArtwork = functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onDelete(event => {
  const accountId = event.params.accountId
  const artworkId = event.data.key
  const artwork = event.data.previous.val() || {}

  const files = artwork.image ? [artwork.image.storageUri] : []
  const publicIds = artwork.published ? [artworkId] : []
  const artistIds = Object.keys(artwork.artists || {})
  const showIds = Object.keys(artwork.shows || {})
  if (files.length === 0 && publicIds.length === 0 && artistIds.length === 0 && showIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    if (files.length > 0) {
      const file = files.pop()
      return admin.storage().refFromURL(file).delete()
    }
    const db = admin.database()
    if (publicIds.length > 0) {
      const publicId = publicIds.pop()
      return db.ref('/artworks/' + publicId).remove()
    }
    // Sync artists
    if (artistIds.length > 0) {
      const artistId = artistIds.pop()
      return db.ref('/accounts/' + accountId + '/artists/' + artistId + '/artworks/' + artworkId).remove()
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop()
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/artworks/' + artworkId).remove()
    }
  }, MAX_CONCURRENT)
  return promisePool.start()
})

exports.updateArtist = functions.database.ref('/accounts/{accountId}/artists/{artistId}').onUpdate(event => {
  const changed = ['published', 'fullName', 'image', 'artworks'].filter(name => event.data.child(name).changed()).length > 0
  if (!changed) {
    return null
  }
  const accountId = event.params.accountId
  const artistId = event.data.key
  const artist = event.data.val() || {}

  const publicIds = artist.published ? [artistId] : []
  const hideIds = artist.published ? [] : [artistId]
  const artworkIds = Object.keys(artist.artworks || {})
  if (publicIds.length === 0 && hideIds.length === 0 && artworkIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    const db = admin.database()
    if (publicIds.length > 0) {
      const publicId = publicIds.pop()
      return db.ref('/artists/' + publicId).set(artist)
    }
    if (hideIds.length > 0) {
      const hideId = hideIds.pop()
      return db.ref('/artists/' + hideId).remove()
    }
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop()
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/artists/' + artistId).update({
        fullName: artist.fullName
      })
    }
  }, MAX_CONCURRENT)
  return promisePool.start()
})

exports.deleteArtist = functions.database.ref('/accounts/{accountId}/artists/{artistId}').onDelete(event => {
  const accountId = event.params.accountId
  const artistId = event.data.key
  const artist = event.data.previous.val() || {}

  const files = artist.image ? [artist.image.storageUri] : []
  const publicIds = artist.published ? [artistId] : []
  const artworkIds = Object.keys(artist.artworks || {})
  if (files.length === 0 && publicIds.length === 0 && artworkIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    if (files.length > 0) {
      const file = files.pop()
      return admin.storage().refFromURL(file).delete()
    }
    const db = admin.database()
    if (publicIds.length > 0) {
      const publicId = publicIds.pop()
      return db.ref('/artists/' + publicId).remove()
    }
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop()
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/artists/' + artistId).remove()
    }
  }, MAX_CONCURRENT)
  return promisePool.start()
})

exports.updateShow = functions.database.ref('/accounts/{accountId}/shows/{showId}').onWrite(event => {
  if (!event.data.exists()) {
    return null
  }
  const changed = ['published', 'title', 'image', 'places'].filter(name => event.data.child(name).changed()).length > 0
  if (!changed) {
    return null
  }
  const accountId = event.params.accountId
  const showId = event.data.key
  const show = event.data.val() || {}
  const prevShow = event.data.previous.val() || {}

  const publicIds = show.published ? [showId] : []
  const hideIds = show.published ? [] : [showId]
  const artworkIds = Object.keys(show.artworks || {})
  const placeIds = Object.keys(show.places || {})
  const prevPlaceIds = Object.keys(prevShow.places || {}).filter(val => placeIds.indexOf(val) == -1)
  if (publicIds.length === 0 && hideIds.length === 0 && artworkIds.length === 0 && placeIds.length === 0 && prevPlaceIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    const db = admin.database()
    if (publicIds.length > 0) {
      const publicId = publicIds.pop()
      return db.ref('/shows/' + publicId).set(show)
    }
    if (hideIds.length > 0) {
      const hideId = hideIds.pop()
      return db.ref('/shows/' + hideId).remove()
    }
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop()
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/shows/' + showId).update({
        title: show.title
      })
    }
    // Sync places
    if (placeIds.length > 0) {
      const placeId = placeIds.pop()
      return db.ref('/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId).update({
        title: show.title
      })
    }
    if (prevPlaceIds.length > 0) {
      const placeId = prevPlaceIds.pop()
      return db.ref('/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId).remove()
    }
  }, MAX_CONCURRENT)
  return promisePool.start()
})

exports.deleteShow = functions.database.ref('/accounts/{accountId}/shows/{showId}').onDelete(event => {
  const accountId = event.params.accountId
  const showId = event.data.key
  const show = event.data.previous.val() || {}

  const files = show.image ? [show.image.storageUri] : []
  const publicIds = show.published ? [showId] : []
  const artworkIds = Object.keys(show.artworks || {})
  const placeIds = Object.keys(show.places || {})
  if (files.length === 0 && publicIds.length === 0 && artworkIds.length === 0 && placeIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    if (files.length > 0) {
      const file = files.pop()
      return admin.storage().refFromURL(file).delete()
    }
    const db = admin.database()
    if (publicIds.length > 0) {
      const publicId = publicIds.pop()
      return db.ref('/shows/' + publicId).remove()
    }
    // Sync artworks
    if (artworkIds.length > 0) {
      const artworkId = artworkIds.pop()
      return db.ref('/accounts/' + accountId + '/artworks/' + artworkId + '/shows/' + showId).remove()
    }
    // Sync places
    if (placeIds.length > 0) {
      const placeId = placeIds.pop()
      return db.ref('/accounts/' + accountId + '/places/' + placeId + '/shows/' + showId).remove()
    }
  }, MAX_CONCURRENT)
  return promisePool.start()
})

exports.updatePlace = functions.database.ref('/accounts/{accountId}/places/{placeId}').onUpdate(event => {
  const changed = ['published', 'title', 'image'].filter(name => event.data.child(name).changed()).length > 0
  if (!changed) {
    return null
  }
  const accountId = event.params.accountId
  const placeId = event.data.key
  const place = event.data.val() || {}

  const publicIds = place.published ? [placeId] : []
  const hideIds = place.published ? [] : [placeId]
  const showIds = Object.keys(place.shows || {})
  if (publicIds.length === 0 && hideIds.length === 0 && showIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    const db = admin.database()
    if (publicIds.length > 0) {
      const publicId = publicIds.pop()
      return db.ref('/places/' + publicId).set(place)
    }
    if (hideIds.length > 0) {
      const hideId = hideIds.pop()
      return db.ref('/places/' + hideId).remove()
    }
    if (showIds.length > 0) {
      const showId = showIds.pop()
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/places/' + placeId).update({
        title: place.title
      })
    }
  }, MAX_CONCURRENT)
  return promisePool.start()
})

exports.deletePlace = functions.database.ref('/accounts/{accountId}/places/{placeId}').onDelete(event => {
  const accountId = event.params.accountId
  const placeId = event.data.key
  const place = event.data.previous.val() || {}

  const files = place.image ? [place.image.storageUri] : []
  const publicIds = place.published ? [placeId] : []
  const showIds = Object.keys(place.shows || {})
  if (files.length === 0 && publicIds.length === 0 && showIds.length === 0) {
    return null
  }
  const promisePool = new PromisePool(() => {
    if (files.length > 0) {
      const file = files.pop()
      return admin.storage().refFromURL(file).delete()
    }
    const db = admin.database()
    if (publicIds.length > 0) {
      const publicId = publicIds.pop()
      return db.ref('/places/' + publicId).remove()
    }
    // Sync shows
    if (showIds.length > 0) {
      const showId = showIds.pop()
      return db.ref('/accounts/' + accountId + '/shows/' + showId + '/places/' + placeId).remove()
    }
  }, MAX_CONCURRENT)
  return promisePool.start()
})

exports.updatePlayerPins = functions.database.ref('player-pins/{pin}').onWrite(event => {
  if (!event.data.exists()) {
    return null
  }
  const changed = event.data.child('accountId').changed()
  if (!changed) {
    return null
  }
  const pin = event.params.pin
  const data = event.data.val() || {}
  if (!data.accountId) {
    return null
  }
  const playerId = data.playerId || crypto.randomBytes(20).toString('hex')
  const uid = `player:${playerId}`
  return admin.auth().getUser(uid).catch(error => {
    if (error.code === 'auth/user-not-found') {
      return admin.auth().createUser({
        uid: uid
      })
    }
    // If error other than auth/user-not-found occurred, fail the whole login process
    throw error
  }).then(function (user) {
    return admin.auth().createCustomToken(user.uid)
  }).then(function (authToken) {
    return admin.database().ref('player-pins/' + pin).update({
      playerId: playerId,
      accessToken: authToken
    })
  })
})

exports.updatePlayer = functions.database.ref('/accounts/{accountId}/players/{playerId}').onWrite(event => {
  if (!event.data.exists()) {
    return null
  }
  const accountId = event.params.accountId
  const playerId = event.data.key
  const player = event.data.val() || {}

  if (!player.pin) {
    return null
  }
  const db = admin.database()
  return db.ref('player-pins').once('value').then((snapshot) => {
    const updates = {}
    snapshot.forEach((child) => {
      const item = child.val() || {}
      if (item.accountId === accountId && child.key !== player.pin) {
        updates['/player-pins/' + child.key] = null
      }
    })
    if (Object.keys(updates).length === 0) {
      return null
    }
    return db.ref().update(updates)
  })
})
