'use strict'

const functions = require('firebase-functions')

const admin = require('firebase-admin')
admin.initializeApp(Object.assign({}, JSON.parse(process.env.FIREBASE_CONFIG), {
  credential: admin.credential.cert(require('./service-account.json'))
}))

const promisePool = require('es6-promise-pool')
const PromisePool = promisePool.PromisePool
const crypto = require('crypto')

// Maximum concurrent process.
const MAX_CONCURRENT = 3

exports.auth = {
  create: functions.auth.user().onCreate((user, context) => {
    if (user.uid.startsWith('player:')) {
      return null
    }
    const db = admin.database()
    const accountId = db.ref('accounts').push().key
    return admin.auth().setCustomUserClaims(user.uid, {accountId: accountId}).then(() => {
      const updates = {}
      updates['accounts/' + accountId + '/title'] = 'Untitled team'
      updates['accounts/' + accountId + '/users/' + user.uid + '/displayName'] = user.displayName
      updates['accounts/' + accountId + '/users/' + user.uid + '/photoUrl'] = user.photoURL
      updates['users/' + user.uid + '/accounts/' + accountId + '/title'] = 'Untitled team'
      return db.ref().update(updates)
    }).then(() => {
      return db.ref('/metadata/' + user.uid).set({refreshTime: context.timestamp})
    })
  }),

  delete: functions.auth.user().onDelete((user) => {
    if (user.uid.startsWith('player:')) {
      return null
    }
    const updates = {}
    updates['/users/' + uid] = null
    updates['/metadata/' + uid] = null
    return admin.database().ref().update(updates)
  })
}

exports.user = {
  delete: functions.database.ref('users/{userId}').onDelete((snapshot) => {
    const userId = snapshot.key
    const user = snapshot.val() || {}

    const updates = {}
    Object.keys(user.accounts || {}).forEach(accountId => {
      updates['/accounts/' + accountId + '/users/' + userId] = null
    })
    if (Object.keys(updates).length === 0) {
      return null
    }
    return admin.database().ref().update(updates)
  }),

  update: functions.database.ref('users/{userId}/accountId').onWrite((change, context) => {
    if (!change.after.exists()) {
      return null
    }
    const claims = {
      accountId: change.after.val()
    }
    return admin.auth().setCustomUserClaims(context.params.userId, claims).then(() => {
      return admin.database().ref('metadata/' + context.params.userId).set({
        refreshTime: context.timestamp,
        accountId: claims.accountId
      })
    })
  })
}

exports.account = {
  update: functions.database.ref('accounts/{accountId}').onUpdate((change, context) => {
    const accountId = change.after.key
    const previous = change.before.val() || {}
    const account = change.after.val() || {}

    const changedFn = (name, change) => {
      const beforeVal = change.before.val() || {}
      const afterVal = change.after.val() || {}
      if (beforeVal.hasOwnProperty(name) && afterVal.hasOwnProperty(name)) {
        return beforeVal[name] !== afterVal[name]
      }
      return beforeVal.hasOwnProperty(name) || afterVal.hasOwnProperty(name)
    }

    const updates = {}
    if (Object.keys(account.users || {}).length === 0) {
      updates['accounts/' + accountId] = null
    } else {
      // Sync users
      const userIds = {}
      if (changedFn('users', change)) {
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
      if (changedFn('invitations', change)) {
        Object.keys(previous.invitations || {}).forEach(invitationId => invitationIds[invitationId] = null)
        Object.keys(account.invitations || {}).forEach(invitationId => delete invitationIds[invitationId])
      }

      if (changedFn('title', change)) {
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

    if (Object.keys(updates).length === 0) {
      return null
    }
    return admin.database().ref().update(updates)
  })
}

exports.invitation = {
  create: functions.database.ref('/invitations/{invitationId}').onCreate((snapshot, context) => {
    const invitationId = snapshot.key
    const invitation = snapshot.val() || {}
    if (invitation.account && invitation.account.id) {
      return admin.database().ref('/accounts/' + invitation.account.id + '/invitations/' + invitationId).set(true)
    }
    return null
  }),

  delete: functions.database.ref('/invitations/{invitationId}').onDelete((snapshot) => {
    const invitationId = snapshot.key
    const invitation = snapshot.val() || {}
    if (invitation.account && invitation.account.id) {
      return admin.database().ref('/accounts/' + invitation.account.id + '/invitations/' + invitationId).remove()
    }
    return null
  }),

  accept: functions.database.ref('/invitations/{invitationId}').onUpdate((change, context) => {
    if (change.after.child('user').exists()) {
      const user = change.after.child('user').val()
      const accountId = change.after.child('account').child('id').val()
      return admin.database().ref('/invitations/' + change.after.key).remove().then(function () {
        const data = {
          'displayName': user.displayName,
          'photoUrl': user.photoUrl
        }
        return admin.database().ref('accounts/' + accountId + '/users/' + user.uid).set(data)
      })
    }
    return null
  })
}

exports.artwork = {
  update: functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onWrite((change, context) => {
    if (!change.after.exists()) {
      return null
    }

    const changedFn = (name, change) => {
      const beforeVal = change.before.val() || {}
      const afterVal = change.after.val() || {}
      if (beforeVal.hasOwnProperty(name) && afterVal.hasOwnProperty(name)) {
        return beforeVal[name] !== afterVal[name]
      }
      return beforeVal.hasOwnProperty(name) || afterVal.hasOwnProperty(name)
    }
    const changed = ['published', 'url', 'title', 'description', 'year', 'vimeoId', 'artists', 'shows', 'controls'].filter(name => changedFn(name, change)).length > 0
    if (!changed) {
      return null
    }
    const accountId = context.params.accountId
    const artworkId = change.after.key
    const artwork = change.after.val() || {}
    const prevArtwork = change.before.val() || {}

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
  }),

  delete: functions.database.ref('/accounts/{accountId}/artworks/{artworkId}').onDelete((snapshot, context) => {
    const accountId = context.params.accountId
    const artworkId = snapshot.key
    const artwork = snapshot.val() || {}

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
}

exports.artist = {
  update: functions.database.ref('/accounts/{accountId}/artists/{artistId}').onUpdate((change, context) => {
    const changedFn = (name, change) => {
      const beforeVal = change.before.val() || {}
      const afterVal = change.after.val() || {}
      if (beforeVal.hasOwnProperty(name) && afterVal.hasOwnProperty(name)) {
        return beforeVal[name] !== afterVal[name]
      }
      return beforeVal.hasOwnProperty(name) || afterVal.hasOwnProperty(name)
    }
    const changed = ['published', 'fullName', 'image', 'artworks'].filter(name => changedFn(name, change)).length > 0
    if (!changed) {
      return null
    }
    const accountId = context.params.accountId
    const artistId = change.after.key
    const artist = change.after.val() || {}

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
  }),

  delete: functions.database.ref('/accounts/{accountId}/artists/{artistId}').onDelete((snapshot, context) => {
    const accountId = context.params.accountId
    const artistId = snapshot.key
    const artist = snapshot.val() || {}

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
}

exports.show = {
  update: functions.database.ref('/accounts/{accountId}/shows/{showId}').onWrite((change, context) => {
    if (!change.after.exists()) {
      return null
    }
    const changedFn = (name, change) => {
      const beforeVal = change.before.val() || {}
      const afterVal = change.after.val() || {}
      if (beforeVal.hasOwnProperty(name) && afterVal.hasOwnProperty(name)) {
        return beforeVal[name] !== afterVal[name]
      }
      return beforeVal.hasOwnProperty(name) || afterVal.hasOwnProperty(name)
    }
    const changed = ['published', 'title', 'image', 'places'].filter(name => changedFn(name, change)).length > 0
    if (!changed) {
      return null
    }
    const accountId = context.params.accountId
    const showId = change.after.key
    const show = change.after.val() || {}
    const prevShow = change.before.val() || {}

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
  }),

  delete: functions.database.ref('/accounts/{accountId}/shows/{showId}').onDelete((snapshot, context) => {
    const accountId = context.params.accountId
    const showId = snapshot.key
    const show = snapshot.val() || {}

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
}

exports.place = {
  update: functions.database.ref('/accounts/{accountId}/places/{placeId}').onUpdate((change, context) => {
    const changedFn = (name, change) => {
      const beforeVal = change.before.val() || {}
      const afterVal = change.after.val() || {}
      if (beforeVal.hasOwnProperty(name) && afterVal.hasOwnProperty(name)) {
        return beforeVal[name] !== afterVal[name]
      }
      return beforeVal.hasOwnProperty(name) || afterVal.hasOwnProperty(name)
    }
    const changed = ['published', 'title', 'image'].filter(name => changedFn(name, change)).length > 0
    if (!changed) {
      return null
    }
    const accountId = context.params.accountId
    const placeId = change.after.key
    const place = change.after.val() || {}

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
  }),

  delete: functions.database.ref('/accounts/{accountId}/places/{placeId}').onDelete((snapshot, context) => {
    const accountId = context.params.accountId
    const placeId = snapshot.key
    const place = snapshot.val() || {}

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
}

exports.playerPin = {
  update: functions.database.ref('player-pins/{pin}').onCreate((snapshot, context) => {
    const pin = context.params.pin
    const data = snapshot.val() || {}
    if (data.accessToken || !data.accountId) {
      return null
    }
    const playerId = crypto.randomBytes(20).toString('hex')
    const uid = `player:${playerId}`
    return admin.auth().getUser(uid).catch(error => {
      if (error.code === 'auth/user-not-found') {
        return admin.auth().createUser({
          uid: uid
        })
      }
      // If error other than auth/user-not-found occurred, fail the whole login process
      throw error
    }).then(user => {
      return admin.auth().createCustomToken(user.uid, {accountId: data.accountId})
    }).then(authToken => {
      return admin.database().ref('player-pins/' + pin).remove().then(() => {
        return admin.database().ref('player-pins/' + pin).set({
          accessToken: authToken
        })
      })
    }).then(() => {
      return admin.database().ref('/accounts/' + data.accountId + '/players/' + playerId).set({
        pin: pin,
        created: context.timestamp
      })
    })
  })
}

exports.player = {
  update: functions.database.ref('/accounts/{accountId}/players/{playerId}').onWrite((change, context) => {
    if (!change.after.exists()) {
      return null
    }
    const accountId = context.params.accountId
    const playerId = change.after.key
    const player = change.after.val() || {}

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
      if (player.artwork) {
        updates['/player-pins/' + player.pin + '/playerId'] = playerId
        updates['/player-pins/' + player.pin + '/artwork/title'] = player.artwork.title
        updates['/player-pins/' + player.pin + '/artwork/author'] = player.artwork.author
        updates['/player-pins/' + player.pin + '/artwork/controls'] = player.artwork.controls
      } else {
        updates['/player-pins/' + player.pin + '/playerId'] = playerId
        updates['/player-pins/' + player.pin + '/artwork'] = null
      }
      if (Object.keys(updates).length === 0) {
        return null
      }
      return db.ref().update(updates)
    })
  })
}
