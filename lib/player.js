'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

exports.update = functions.database.ref('/accounts/{accountId}/players/{playerId}').onWrite((change, context) => {
  if (!change.after.exists()) {
    return null
  }
  const accountId = context.params.accountId;
  const playerId = context.params.playerId;
  const {artwork, pin} = change.after.val() || {};

  if (!pin) {
    return null
  }
  const db = admin.database();
  return db.ref('player-pins').once('value').then(snapshot => {
    const updates = {};
    snapshot.forEach((child) => {
      const item = child.val() || {};
      if (item.accountId === accountId && child.key !== pin) {
        updates[`/player-pins/${child.key}`] = null
      }
    });
    if (artwork) {
      updates[`/player-pins/${pin}/playerId`] = playerId;
      updates[`/player-pins/${pin}/artwork/title`] = artwork.title;
      updates[`/player-pins/${pin}/artwork/author`] = artwork.author;
      updates[`/player-pins/${pin}/artwork/controls`] = artwork.controls
    } else {
      updates[`/player-pins/${pin}/playerId`] = playerId;
      updates[`/player-pins/${pin}/artwork`] = null
    }
    if (Object.keys(updates).length === 0) {
      return null
    }
    return db.ref().update(updates)
  })
});
