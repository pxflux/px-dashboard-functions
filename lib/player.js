'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

exports.update = functions.database.ref('/accounts/{accountId}/players/{playerId}').onWrite((change, context) => {
  if (!change.after.exists()) {
    return null
  }
  const accountId = context.params.accountId;
  const playerId = change.after.key;
  const player = change.after.val() || {};

  if (!player.pin) {
    return null
  }
  const db = admin.database();
  return db.ref('player-pins').once('value').then((snapshot) => {
    const updates = {};
    snapshot.forEach((child) => {
      const item = child.val() || {};
      if (item.accountId === accountId && child.key !== player.pin) {
        updates['/player-pins/' + child.key] = null
      }
    });
    if (player.artwork) {
      updates['/player-pins/' + player.pin + '/playerId'] = playerId;
      updates['/player-pins/' + player.pin + '/artwork/title'] = player.artwork.title;
      updates['/player-pins/' + player.pin + '/artwork/author'] = player.artwork.author;
      updates['/player-pins/' + player.pin + '/artwork/controls'] = player.artwork.controls
    } else {
      updates['/player-pins/' + player.pin + '/playerId'] = playerId;
      updates['/player-pins/' + player.pin + '/artwork'] = null
    }
    if (Object.keys(updates).length === 0) {
      return null
    }
    return db.ref().update(updates)
  })
});
