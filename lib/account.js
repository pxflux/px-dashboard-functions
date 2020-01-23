'use strict';

const functions = require('firebase-functions');
const admin = require('./firebase');
const changedFn = require('./changed-fn');

exports.update = functions.database.ref('accounts/{accountId}').onUpdate((change, context) => {
  const accountId = context.params.accountId;
  const previous = change.before.val() || {};
  const account = change.after.val() || {};

  const updates = {};
  if (Object.keys(account.users || {}).length === 0) {
    updates[`accounts/${accountId}`] = null
  } else {
    // Sync users
    const userIds = {};
    if (changedFn('users', change)) {
      // Delete removed
      Object.keys(previous.users || {}).forEach(userId => userIds[userId] = null);
      Object.keys(account.users || {}).forEach(userId => delete userIds[userId])
      // Add new
    }
    Object.keys(account.users || {}).forEach(userId => userIds[userId] = {title: account.title});

    // Sync invitations
    const invitationIds = {};
    if (changedFn('invitations', change)) {
      Object.keys(previous.invitations || {}).forEach(invitationId => invitationIds[invitationId] = null);
      Object.keys(account.invitations || {}).forEach(invitationId => delete invitationIds[invitationId])
    }

    if (changedFn('title', change)) {
      // Sync users
      Object.keys(account.users || {}).forEach(userId => {
        userIds[userId] = {title: account.title}
      });
      // Sync invitations
      Object.keys(account.invitations || {}).forEach(invitationId => {
        invitationIds[invitationId] = {title: account.title}
      })
    }

    Object.keys(userIds).forEach(userId => {
      updates[`/users/${userId}/accounts/${accountId}`] = userIds[userId]
    });
    Object.keys(invitationIds).forEach(invitationId => {
      updates[`/invitations/${invitationId}/accounts/${accountId}`] = invitationIds[invitationId]
    })
  }

  if (Object.keys(updates).length === 0) {
    return null
  }
  return admin.database().ref().update(updates)
});
