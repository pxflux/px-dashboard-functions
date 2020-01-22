'use strict';

const functions = require('firebase-functions');
const stripe = require('stripe')(functions.config().stripe.secret_key);
const admin = require('firebase-admin');

const webhook = require('./webhook');

function items(plan) {
  switch (plan) {
    case 'fix_monthly':
      return [{plan: 'plan_GVhp3JIYrrWSql'}];
    case 'fix_yearly':
      return [{plan: 'plan_GVhqoe7nkbfyh8'}];
    case 'flex':
      return [{plan: 'plan_GVhoTg7wZ9sble'}, {plan: 'plan_GVhl6xLOMeeFLv'}];
  }
  return undefined;
}

exports.setup = functions.https.onCall(async ({paymentMethodId, planId}, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
  }
  const uid = context.auth.uid;
  const user = (await admin.database().ref(`users/${uid}`).once('value')).val();
  if (user === null) {
    throw new functions.https.HttpsError('not-found', `user [${uid}] notfound`);
  }
  let stripeId;
  if (!user.hasOwnProperty('stripeId')) {
    const customer = await stripe.customers.create({
      payment_method: paymentMethodId,
      invoice_settings: {
        default_payment_method: paymentMethodId
      }
    });
    stripeId = customer.id;
    await admin.database().ref(`users/${uid}`).update({stripeId});
  } else {
    stripeId = user.stripeId;
  }
  const accountId = context.auth.token.accountId;
  try {
    const {id, latest_invoice: {payment_intent: intent}} = await stripe.subscriptions.create({
      customer: stripeId,
      items: [{plan: planId}],
      expand: ['latest_invoice.payment_intent'],
      metadata: {accountId}
    });
    if (intent) {
      const {client_secret: secret, status} = intent;
      if (status === 'requires_action' || status === 'requires_payment_method') {
        return {id, status: 'requires_action', secret};
      }
    }
    await admin.database().ref(`accounts/${accountId}/subscription`).update({id, planId});
    return {id, status: 'succeeded'};
  } catch (e) {
    console.error(e);
    throw new functions.https.HttpsError('unknown', e.message, e);
  }
});

exports.subscription = functions.https.onCall(async ({id}, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('failed-precondition', 'The function must be called while authenticated.');
  }
  try {
    const accountId = context.auth.token.accountId;
    const {id, items: {data}} = await stripe.subscriptions.retrieve(id);
    const plan = Array.isArray(data) ? {planId: data[0].plan.id} : {};
    await admin.database().ref(`accounts/${accountId}/subscription`).update({id, ...plan});
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
