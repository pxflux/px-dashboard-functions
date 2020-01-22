'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');

exports.create = functions.database.ref('/invitations/{invitationId}').onCreate((snapshot, context) => {
  const invitationId = snapshot.key;
  const invitation = snapshot.val() || {};
  if (invitation.account && invitation.account.id) {
    return admin.database().ref('/accounts/' + invitation.account.id + '/invitations/' + invitationId).set(true)
  }
  return null
});

exports.delete = functions.database.ref('/invitations/{invitationId}').onDelete((snapshot) => {
  const invitationId = snapshot.key;
  const invitation = snapshot.val() || {};
  if (invitation.account && invitation.account.id) {
    return admin.database().ref('/accounts/' + invitation.account.id + '/invitations/' + invitationId).remove()
  }
  return null
});

exports.accept = functions.database.ref('/invitations/{invitationId}').onUpdate((change, context) => {
  if (change.after.child('user').exists()) {
    const user = change.after.child('user').val();
    const accountId = change.after.child('account').child('id').val();
    return admin.database().ref('/invitations/' + change.after.key).remove().then(function () {
      const data = {
        'displayName': user.displayName,
        'photoUrl': user.photoUrl
      };
      return admin.database().ref('accounts/' + accountId + '/users/' + user.uid).set(data)
    })
  }
  return null
});
