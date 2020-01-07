'use strict';

const functions = require('firebase-functions');
const stripe = require('stripe')(functions.config().stripe.secret_key);

const webhook = require('./webhook');

exports.setup = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
  }
  try {
    return await stripe.setupIntents.create();
  } catch (e) {
    console.error(e);
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
