'use strict';

/**
 * @param {Stripe} stripe
 * @param {admin.database.Database} db
 * @param {string} uid
 * @param {string?} paymentMethodId
 * @return {Promise<string>}
 */
async function customerId(stripe, db, uid, paymentMethodId) {
  const ref = db.ref(`users/${uid}`);
  const user = (await ref.once('value')).val();
  if (user === null) {
    throw new Error(`User with [${uid}] notfound`);
  }
  if (user.hasOwnProperty('stripeId')) {
    return user.stripeId;
  }
  const customer = await stripe.customers.create({
    metadata: {
      uid
    },
    payment_method: paymentMethodId,
    invoice_settings: {
      default_payment_method: paymentMethodId
    }
  });
  await ref.update({
    stripeId: customer.id
  });
  return customer.id
}

/**
 * @param {admin.database.Database} db
 * @param {Stripe} stripe
 * @param {string} uid
 * @param {string} accountId
 * @param {string} planId
 * @param {string?} paymentMethodId
 * @return {Promise<{id?: string, status: string, secret?: string}>}
 */
module.exports = async function (db, stripe, {uid, accountId, planId, paymentMethodId}) {
  const customerId = await customerId(stripe, db, uid, paymentMethodId);
  const ref = db.ref(`accounts/${accountId}/subscription`);
  const subscription = (await ref.once('value')).val();
  if (subscription) {
    if (subscription.planId !== planId) {
      await stripe.subscriptions.del(subscription.id);
    }
    return {id: subscription.id, status: 'succeeded'};
  }
  const {id, latest_invoice: {payment_intent: intent}} = await stripe.subscriptions.create({
    customer: customerId,
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
  await ref.update({id, planId});
  return {id, status: 'succeeded'};
};
