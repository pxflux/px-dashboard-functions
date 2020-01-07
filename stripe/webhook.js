'use strict';

const functions = require('firebase-functions');

/**
 * @param stripe
 * @param {Request} req
 * @param {express.Response} res
 * @return {Promise<void>}
 */
module.exports = async function (stripe, req, res) {
  const {data: {object: {payment_method}}, type: eventType} = await stripe.webhooks.constructEvent(
    req.rawBody,
    req.headers['stripe-signature'],
    functions.config().stripe.webhook_secret
  );
  if (eventType === 'setup_intent.succeeded') {
    const {billing_details: {email}} = await stripe.paymentMethods.retrieve(payment_method);
    const customer = await stripe.customers.create({payment_method, email});

    // At this point, associate the ID of the Customer object with your
    // own internal representation of a customer, if you have one.
    console.log(`🔔  A Customer has successfully been created ${customer.id}`);

    // You can also attach a PaymentMethod to an existing Customer
    // https://stripe.com/docs/api/payment_methods/attach
  }
  res.json({received: true});
};
