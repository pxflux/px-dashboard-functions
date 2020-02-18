'use strict';

const functions = require('firebase-functions');
const stripe = require('stripe')(functions.config().stripe.secret_key);
const admin = require('./../firebase');

const webhook = require('./webhook');
const setup = require('./setup');

exports.setup = functions.https.onCall(async ({paymentMethodId, planId}, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
  }
  try {
    return setup(admin.database(), stripe, {
      uid: context.auth.uid,
      accountId: context.auth.token.accountId,
      paymentMethodId,
      planId
    });
  } catch (e) {
    throw new functions.https.HttpsError('unknown', e.message, e);
  }
});

exports.subscription = functions.https.onCall(async ({id}, {auth}) => {
  if (!auth) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
  }
  try {
    const accountId = auth.token.accountId;
    const {id, items: {data}} = await stripe.subscriptions.retrieve(id);
    const plan = Array.isArray(data) ? {planId: data[0].plan.id} : {};
    await admin.database().ref(`accounts/${accountId}/subscription`).update(Object.assign({}, {id}, plan));
  } catch (e) {
    throw new functions.https.HttpsError('unknown', e.message, e);
  }
});

exports.webhook = functions.https.onRequest(async (req, resp) => {
  if (req.method !== 'POST') {
    resp.sendStatus(403);
    return
  }
  try {
    await webhook(stripe, req, resp);
  } catch (e) {
    console.error(e);
    resp.sendStatus(500);
  }
});
