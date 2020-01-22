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
  res.json({received: true});
};
