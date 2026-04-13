import { ResponseBuilder } from "../../helpers/responseBuilder";

const stripe = require("stripe")(process.env.STRIPE_SECRET);
import user from "../../model/user.schema";
// const models = require('@models');
// const _ = require('lodash');
// const moment = require('moment');
// const helper = require('@helper');
// const { successResponse, errorResponse } = require('@helper');
// const { handleWebhookEvent, createRefund } = require('./functions');
// const Op = models.Sequelize.Op;
// const NOTIFY = require('@controllers/api/notificationController');

export let stripeHelperController = {
  //   processRefund: async (
  //     appointment_id,
  //     refunded_by,
  //     refunded_from = 'p',
  //     reason = 'Appointment Cancelled',
  //     refund_amount = 'p'
  //   ) => {
  //     let stripeSetup = await stripeHelperController.getStripeSetup();
  //     const platformCharge = stripeSetup ? stripeSetup.platfromCharge : 0;
  //     const transaction = await models.transaction_log.findOne({
  //       where: { appointmentId: appointment_id, type: { [Op.ne]: 0 } },
  //       order: [['id', 'DESC']],
  //     });

  //     if (!transaction) return { success: false, free: true };
  //     let refundAmount = Number(transaction.balanceTransaction) - Number(platformCharge);

  //     switch (refund_amount) {
  //       // if it is a full refund request
  //       case 'f':
  //         // then refund the initial 10%. if it was not a partial payment this will refund full amount
  //         await createRefund(transaction.id, appointment_id, transaction.data, refunded_by, refunded_from, reason);
  //         break;

  //       // if it is a partial refund request
  //       case 'p':
  //         // calculate and refund 90% from the fully paid amount if is not a partial payment
  //         await createRefund(
  //           transaction.id,
  //           appointment_id,
  //           transaction.data,
  //           refunded_by,
  //           refunded_from,
  //           reason,
  //           //transaction.balanceTransaction * 100 * 0.9
  //           refundAmount * 100
  //         );
  //         break;

  //       default:
  //         break;
  //     }

  //     const appointment = await models.appointment.findByPk(appointment_id);
  //     appointment.fullyPaid = 3;
  //     await appointment.save();

  //     return { success: true, transaction, free: false };
  //   },

  createCustomer: function (userData: any) {
    return new Promise((resolve, reject) => {
      stripe.customers
        .create({ email: userData.email, name: userData.fullname })
        .then((customer) => {
          console.log('createCustomer resolve', customer);
          resolve(customer);
        })
        .catch((err) => {
          console.log('createCustomer', err);
          reject(err);
        });
    });
  },

  updateCustomer: async function (req, res) {
    try {
      const customer = await stripe.customers.update(req.params.id || req.authUser.stripe_account_id, req.body);
      res.send(customer);
    } catch (e) {
      res.status(422).send(e);
    }
  },

  createCardNonce: function (stripe_account_id, cardToken) {
    return new Promise((resolve, reject) => {
      stripe.customers
        .createSource(stripe_account_id, { source: cardToken })
        .then((source) => {
          resolve(source);
        })
        .catch((err) => {
          console.log('createCardNonce', err);
          reject(err);
        });
    });
  },

  // addCard: function (req, res, next) {
  //   if (!req.body.cardToken) res.status(400).send(errorResponse('Please send card token!'));
  //   let userId = req.authUser.id;
  //   let cardDetails = req.body.cardToken;
  //   if (req.authUser.stripe_account_id) {
  //     stripeHelperController
  //       .createCardNonce(req.authUser.stripe_account_id, cardDetails)
  //       .then((cardRes) => {
  //         return res.send({ error: false, message: 'Card added successfully', data: cardRes });
  //       })
  //       .catch((err) => {
  //         console.log('addCard', err);
  //         return res.status(422).send(err.message);
  //       });
  //   } else {
  //     console.log('Stripe New Customer');
  //     stripeHelperController
  //       .createCustomer(req.authUser)
  //       .then((customerRes) => {
  //         return updateAccount(customerRes.id, userId);
  //       })
  //       .then((customer) => {
  //         if (customer.id) return stripeHelperController.createCardNonce(customer.id, cardDetails);
  //         else return null;
  //       })
  //       .then((cardRes) => {
  //         return res.send(successResponse(cardRes));
  //       })
  //       .catch((err) => {
  //         console.log('addCard New Customer', err);
  //         return res.status(422).send(errorResponse(err.message));
  //       });
  //   }
  // },

  updateCard: async function (req, res, next) {
    try {
      const card = await stripe.customers.updateSource(req.authUser.stripe_account_id, req.params.card_id, req.body);
      res.send(card);
    } catch (e) {
      // res.status(422).send(errorResponse(e));
      // res.status(422).send(ResponseBuilder.error(e));
      ResponseBuilder.badRequest(
        "Update card err"
      );
    }
  },

  // listCard: async function (req, res) {
  //   let customer;
  //   let stripe_account_id = req.query.stripe_account_id ? req.query.stripe_account_id : req.authUser.stripe_account_id;
  //   if (!stripe_account_id) {
  //     await stripeHelperController
  //       .createCustomer(req.authUser)
  //       .then((resCus) => {
  //         customer = resCus;
  //         stripe_account_id = resCus.id;
  //         updateAccount(resCus.id, req.authUser.id);
  //       })
  //       .catch((err) => {
  //         return res.status(422).send(errorResponse(err));
  //       });
  //   } else {
  //     customer = await stripe.customers.retrieve(stripe_account_id);
  //   }

  //   await stripe.customers.listSources(stripe_account_id, { object: 'card' }, function (err, cards) {
  //     if (err) {
  //       return res.status(422).send(errorResponse(err.message));
  //     }
  //     if (!('data' in cards)) cards = successResponse('No data founds');
  //     cards.data = cards.data.map((item) => {
  //       if (item.id == customer.default_source) {
  //         return { ...item, default: true };
  //       } else {
  //         return { ...item, default: false };
  //       }
  //     });
  //     return res.status(200).send(cards);
  //   });
  // },

  // listPaymentMethod: async function (req, res) {
  //   const stripe_account_id = await stripeHelperController.getStripeAccount(req.authUser.id);
  //   const paymentMethods = await stripe.paymentMethods.list({ customer: stripe_account_id, type: 'card' });
  //   res.send(successResponse(paymentMethods));
  // },

  // updateDefaultPayementMethod: async function (req, res) {
  //   const user = await models.user.findOne({
  //     attributes: ['stripe_account_id'],
  //     where: {
  //       id: req.authUser.id,
  //     },
  //   });
  //   const pms = await stripe.paymentMethods.list({ customer: user.stripe_account_id, type: 'card' });
  //   const pm = pms.data.find((o) => o.id == req.body.pm_id);
  //   if (!pm) return res.send(errorResponse('Invalid Payment Method'));

  //   await models.user.update(
  //     { defaultPaymentMethod: pm.id },
  //     {
  //       where: {
  //         id: req.authUser.id,
  //       },
  //     },
  //     { returning: true }
  //   );

  //   return res.send(successResponse('Default Payment method updated!'));
  // },

  cardDetails: function (stripe_account_id, cardId) {
    return new Promise((resolve, reject) => {
      stripe.customers
        .retrieveSource(stripe_account_id, cardId)
        .then((card) => {
          resolve(card);
        })
        .catch((err) => {
          console.log('cardDetails', err);
          reject(err);
        });
    });
  },

  deleteCard: async function (req, res) {
    // if (!req.authUser.stripe_account_id) return res.status(400).send(errorResponse('Customer Id not found'));

    if (!req.authUser.stripe_account_id) return res.status(400).send(ResponseBuilder.badRequest(
      "Customer Id not found"
    ));
    const paymentMethod = await stripe.paymentMethods.detach(req.params.card_id);

    // return res.send(successResponse({ message: 'Card deleted successfully', data: paymentMethod }));
    return res.send(ResponseBuilder.data(paymentMethod, 'Card deleted successfully'));
  },

  getCustomer: function (req, res) {
    //'cus_FWsEOaxptEY6Bx',
    stripe.customers
      .retrieve(req.params.stripe_account_id ? req.params.stripe_account_id : req.authUser.stripe_account_id)
      .then((resData) => {
        res.send(resData);
      })
      .catch((err) => {
        console.log('getCustomer', err);
        res.send(err);
      });
  },

  getAccount: function (req, res) {
    //'cus_FWsEOaxptEY6Bx',
    const stripeAccId = req.params.stripe_account_id ? req.params.stripe_account_id : req.authUser.stripe_account_id;
    stripe.accounts
      .retrieve(stripeAccId)
      .then((resData) => {
        return res.send(resData);
      })
      .catch((err) => {
        console.log('getAccount', err);
        return res.send(err);
      });
  },

  getAccountByUserId: async function (stripe_account_id: string) {
     return stripe.accounts
        .retrieve(stripe_account_id)
        .then((resData: any) => {
          return resData
        })
        .catch((err) => {
          console.log('getAccount', err);
          return err
        });
  },

  deleteCustomer: function (req, res) {
    stripe.customers
      .del('cus_FJtQpbTwJeI2TC')
      .then((resData) => {
        console.log(resData);
      })
      .catch((err) => {
        console.log(err);
      });
  },

  createAccount: async (userInfo: any) => {
    try {
      return await stripe.accounts.create({
        type: 'express',
        country: 'US',
        default_currency: 'USD',
        email: userInfo.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
      });
    } catch (err) {
      return err;
    }
  },

  // addBankAccount: async (req, res) => {
  //   let stripe_account_id = req.authUser.stripe_account_id;
  //   if (req.body.selectedClinicId) {
  //     let selectedClinic = await models.user.findOne({
  //       attributes: ['stripe_account_id'],
  //       where: { id: req.body.selectedClinicId },
  //     });
  //     stripe_account_id = selectedClinic.stripe_account_id;
  //   }

  //   if (!stripe_account_id) {
  //     res.status(422).send(ResponseBuilder.badRequest('Please create an account!'));
  //   }

  //   if (!req.body.returnUrl) {
  //     res.status(422).send(ResponseBuilder.badRequest('returnUrl missing!'));
  //   }
  //   try {
  //     const accountLink = await stripe.accountLinks.create({
  //       account: stripe_account_id,
  //       refresh_url: `${req.body.returnUrl}?refresh=true`,
  //       return_url: req.body.returnUrl,
  //       type: 'account_onboarding',
  //     });
  //     console.log(accountLink);
  //     // return res.send(successResponse(accountLink));
  //     return res.send(ResponseBuilder.data(accountLink, ''));
  //   } catch (e) {
  //     return res.status(422).send(ResponseBuilder.badRequest(e.message));
  //   }
  // },

  defaultBankAccount: async (req, res) => {
    if (!req.authUser.stripe_account_id || !req.body.bankAccountId)
      // return res.status(422).send(errorResponse('Bank account needed!'));
      return res.status(422).send(ResponseBuilder.badRequest('Bank account needed!'));
    // ResponseBuilder.badRequest(
    //   "Customer Id not found"
    // );
    try {
      const account = await stripe.accounts.updateExternalAccount(
        req.authUser.stripe_account_id,
        req.body.bankAccountId,
        { default_for_currency: true }
      );
      // return res.send(successResponse(account));
      return res.send(ResponseBuilder.data(account, ''));
    } catch (e) {
      return res.status(422).send(ResponseBuilder.badRequest(e.message));
    }
  },

  createBankAccount: async (req, res) => {
    if (!req.authUser.stripe_account_id) res.status(422).send(ResponseBuilder.badRequest('Please create an account!'));
    try {
      const bankAccount = await stripe.accounts.createExternalAccount(req.authUser.stripe_account_id, req.body);
      // return res.send(successResponse(bankAccount));
      return res.send(ResponseBuilder.data(bankAccount, ''));
    } catch (e) {
      res.status(422).send(ResponseBuilder.badRequest(e.message));
    }
  },

  updateBankAccount: async (req, res) => {
    if (!req.authUser.stripe_account_id) res.status(422).send(ResponseBuilder.badRequest('Please create an account!'));
    try {
      const bankAccount = await stripe.accounts.updateExternalAccount(
        req.authUser.stripe_account_id,
        req.params.id,
        req.body
      );
      // return res.send(successResponse(bankAccount));
      return res.send(ResponseBuilder.data(bankAccount, ''));
    } catch (e) {
      res.status(422).send(ResponseBuilder.badRequest(e.message));
    }
  },

  deleteBankAccount: async (req, res) => {
    if (!req.authUser.stripe_account_id) res.status(422).send(ResponseBuilder.badRequest('Please create an account!'));
    try {
      const deteteAccount = await stripe.accounts.deleteExternalAccount(req.authUser.stripe_account_id, req.params.id);
      // return res.send(successResponse(deteteAccount));
      return res.send(ResponseBuilder.data(deteteAccount, ''));
    } catch (e) {
      res.status(422).send(ResponseBuilder.badRequest(e.message));
    }
  },

  //   deleteStripeAccount: async (req, res) => {
  //     console.log(req.body);
  //     try {
  //       if (!req.body.stripe_account_id) res.status(422).send(errorResponse('stripe_account_id is missing!'));
  //       const splitTable = await models.payment_split_details.findOne({
  //         where: {
  //           stripe_account_id: req.body.stripe_account_id,
  //           payoutDate: { [Op.gte]: moment(new Date()).format('YYYY-MM-DD HH:mm:ss') },
  //         },
  //         order: [['id', 'DESC']],
  //       });
  //       const user = await models.user.findOne({
  //         where: {
  //           stripe_account_id: req.body.stripe_account_id,
  //         },
  //       });
  //       const PracticepractitionerAppoinment = await models.appointment.findOne({
  //         where: {
  //           [Op.or]: [{ practitioner_id: user.id }, { practiceId: user.id }],

  //           when: { [Op.gte]: moment(new Date()).format('YYYY-MM-DD HH:mm:ss') },
  //           fullyPaid: 0,
  //         },
  //         order: [['id', 'DESC']],
  //       });
  //       if (PracticepractitionerAppoinment) {
  //         return res.status(422).send(errorResponse('Future payment ready to split for this account'));
  //       }
  //       if (splitTable) {
  //         return res.status(422).send(errorResponse('Future payout is Remaning for this account'));
  //       }
  //       const deleted = await stripe.accounts.del(req.body.stripe_account_id);
  //       user.stripe_account_id = '';
  //       user.account_onboarding = 0;
  //       await user.save();
  //       NOTIFY.notificationForStripeAccountDelete(user.id);
  //       return res.send(successResponse(deleted));
  //     } catch (e) {
  //       res.status(422).send(errorResponse(e.message));
  //     }
  //   },

  /**
   * req.body.stripe_account_id: this is clinic's stripe id
   */

  // charge: async (req, res) => {
  //   if (!req.body.stripe_account_id) return res.status(422).send(ResponseBuilder.badRequest('stripe_account_id not found'));
  //   const appointmentDetails = await models.appointment.findByPk(req.body.appointmentId[0]);
  //   if (!appointmentDetails) return res.status(422).send(ResponseBuilder.badRequest('Appointment not found'));
  //   const doctorAppointmentTypeCharge = await models.doctors_appointment_type.findOne({
  //     where: {
  //       appointmentTypeId: appointmentDetails.apptTypeId,
  //       clinicId: appointmentDetails.practiceId,
  //       doctorId: appointmentDetails.practitioner_id,
  //     },
  //   });
  //   const appointmentChargeAmount = doctorAppointmentTypeCharge ? parseFloat(doctorAppointmentTypeCharge.pricing) : 50;

  //   try {
  //     let chargeData = null;
  //     if (appointmentChargeAmount > 0) {
  //       const patient = {
  //         source: process.env.STRIPE_TEST_SOURCE,
  //         amount: appointmentChargeAmount * 100,
  //         currency: 'aud',
  //         id: req.authUser.id,
  //       };
  //       chargeData = await stripeHelperController.chargeWithTransfer(patient, req.body.stripe_account_id);
  //     }

  //     const transactionLog = await stripeHelperController.createTransactionLog({
  //       userId: req.authUser.id,
  //       practiceId: req.body.practiceId || null,
  //       appointmentId: req.body.appointmentId[0] || null,
  //       connectedAccountId: req.body.stripe_account_id,
  //       transactionDate: Date.now(),
  //       amount: appointmentChargeAmount,
  //       balanceTransaction: chargeData ? chargeData.balance_transaction : null,
  //       data: chargeData,
  //     });
  //     // res.send(successResponse(transactionLog));
  //     return res.send(ResponseBuilder.data(transactionLog, ''));
  //   } catch (e) {
  //     res.status(422).send(errorResponse(e));
  //   }
  // },

  chargeWithTransfer: (customerData, stripe_account_id) => {
    return stripe.charges.create({
      source: customerData.source,
      amount: customerData.amount,
      currency: customerData.currency,
      description: 'LifeForce',
      statement_descriptor: 'LifeForce',
      on_behalf_of: stripe_account_id,
      // The destination parameter directs the transfer of funds from platform to pilot
      transfer_data: {
        // Send the amount for the pilot after collecting a 20% platform fee:
        // the `amountForPilot` method simply computes `ride.amount * 0.8`
        amount: customerData.amount - 500,
        // The destination of this charge is the pilot's Stripe account
        destination: stripe_account_id,
      },
    });
  },

  // createTransactionLog: (data) => {
  //   return models.transaction_log.create(data);
  // },

  // createStripePaymentSplit: (data) => {
  //   return models.payment_split_details.create(data);
  // },

  // getStripeSetup: async () => {
  //   const stripe_setup = await models.stripe_setup.findOne({
  //     order: [['id', 'DESC']],
  //   });
  //   return stripe_setup;
  // },

  // createSetupIntent: async (req, res) => {
  //   // // const user = await models.user.findByPk(req.authUser.id);
  //   let stripe_account_id = await stripeHelperController.getStripeAccount(req.authUser.id);
  //   const ephemeralKey = await stripe.ephemeralKeys.create({ customer: stripe_account_id }, { apiVersion: '2020-08-27' });

  //   const setupIntent = await stripe.setupIntents.create({
  //     customer: stripe_account_id,
  //     description: 'Thanks for booking appointment!',
  //     metadata: {
  //       appointment: 'appointment id',
  //     },
  //   });

  //   return res.json(
  //     successResponse({
  //       setupIntent: setupIntent.client_secret,
  //       customer: stripe_account_id,
  //       publishableKey: process.env.STRIPE_PUBLISAHBLE_KEY,
  //       ephemeralKey: ephemeralKey.secret,
  //       meta: 'This a test api just use to create a setupIntent.',
  //     })
  //   );
  // },

  // createPaymentIntent: async (req, res) => {
  //   let stripeSetup = await stripeHelperController.getStripeSetup();
  //   if (
  //     !stripeSetup ||
  //     stripeSetup.paidoutDay < 0 ||
  //     stripeSetup.platfromCharge == '' ||
  //     stripeSetup.platfromCharge === null
  //   ) {
  //     return res.status(422).send(errorResponse({ message: 'stripe Setup missing' }));
  //   }

  //   const appointmentDetails = await models.appointment.findByPk(req.body.appointmentId[0]);
  //   if (!appointmentDetails) return res.status(422).send(errorResponse('Appointment not found'));

  //   let price = await stripeHelperController.getAppointmentPricing(appointmentDetails);
  //   if (price < 0.1) {
  //     appointmentDetails.status = 1;
  //     appointmentDetails.fullyPaid = 4;
  //     appointmentDetails.isFree = 1;
  //     await appointmentDetails.save();
  //     //insert in transation log with type 0
  //     await stripeHelperController.createTransactionLog({
  //       userId: req.authUser.id,
  //       practiceId: appointmentDetails.practiceId || null,
  //       appointmentId: req.body.appointmentId[0] || null,
  //       doctor_paymentvia: 0,
  //       transactionDate: Date.now(),
  //       amount: 0,
  //       balanceTransaction: 0,
  //       stripeFee: 0,
  //       deviceType: req.body.deviceType,
  //       type: 0,
  //     });
  //     return res.send(successResponse({ message: 'This appointment is free!', price: 0 }));
  //   }

  //   const userStripeId = await stripeHelperController.getStripeAccount(req.authUser.id);
  //   const clinicStripeId = await stripeHelperController.getStripeAccount(appointmentDetails.practiceId);
  //   const doctorStripeId = await stripeHelperController.getStripeAccount(appointmentDetails.practitioner_id);
  //   let platformCharge = 0;
  //   platformCharge = Number(stripeSetup.platfromCharge); //here 5 is fixed platform charge
  //   // const doingFullPayment = moment(appointmentDetails.when).diff(moment(new Date()), 'h') <= 24 ? 1 : 0;
  //   const doingFullPayment = 1; // for full payment every time
  //   // add platform charge in appoinment price
  //   price += Number(platformCharge);
  //   // const payNow = Math.floor(doingFullPayment ? price : platformCharge);
  //   const payNow = price.toFixed(2);
  //   //const payNow = Math.floor(doingFullPayment ? price : price * 0.1)
  //   try {
  //     const defaultPaymentMethod = await stripeHelperController.getDefaultPaymentMethod(req.authUser.id);
  //     if (!defaultPaymentMethod) return res.send(errorResponse('No default payment method attached!'));
  //     console.log('doingFullPayment', doingFullPayment);

  //     const doctorDetails = await models.user.findOne({
  //       attributes: ['name', 'email'],
  //       where: { id: appointmentDetails.practitioner_id },
  //     });
  //     let description = `Booking with ${doctorDetails.name}`;
  //     if (!doingFullPayment) {
  //       description = 'Booking fee';
  //     }
  //     let stripeFinalAmount = Number(payNow) * 100;
  //     const paymentIntent = await stripe.paymentIntents.create({
  //       amount: stripeFinalAmount.toFixed(),
  //       currency: 'aud',
  //       customer: userStripeId,
  //       payment_method: defaultPaymentMethod,
  //       off_session: true,
  //       confirm: true,
  //       description: description,
  //       transfer_group: 'group_transfer_' + Date.now(),
  //       // application_fee_amount: payNow * 10,
  //       // transfer_data: {
  //       //   destination: clinicStripeId,
  //       // },
  //     });

  //     //need to start again
  //     let getPaymentviaDetails = await helper.getPaymentviaDetails(
  //       appointmentDetails.practiceId,
  //       appointmentDetails.practitioner_id
  //     );

  //     let chrageData = paymentIntent.charges.data.find((o) => o.id == paymentIntent.latest_charge);
  //     const balanceTransaction = await stripe.balanceTransactions.retrieve(chrageData.balance_transaction);
  //     await stripeHelperController.createTransactionLog({
  //       userId: req.authUser.id,
  //       practiceId: appointmentDetails.practiceId || null,
  //       appointmentId: req.body.appointmentId[0] || null,
  //       connectedAccountId: userStripeId,
  //       doctor_paymentvia: getPaymentviaDetails ? getPaymentviaDetails.paymentvia : 0,
  //       transactionDate: Date.now(),
  //       amount: payNow,
  //       balanceTransaction: price,
  //       data: paymentIntent.id,
  //       stripeFee: balanceTransaction.fee,
  //       deviceType: req.body.deviceType,
  //     });
  //     //For split payment

  //     // if (doingFullPayment) {
  //     //   let obj = {};
  //     //   obj.appointmentDetails = appointmentDetails;
  //     //   obj.payNow = payNow;
  //     //   obj.platformCharge = platformCharge;
  //     //   obj.paymentIntent = paymentIntent;
  //     //   obj.isNextPayment = 0;
  //     //   await stripeHelperController.stripePaymentSplitDetailsSave(obj);
  //     // }

  //     // /**For stipe payment split for partner */
  //     // const userClinic = await models.user.findOne({
  //     //   attributes: ['partner_referral_code', 'email'],
  //     //   where: { id: appointmentDetails.practiceId },
  //     // });

  //     // if (userClinic && userClinic.partner_referral_code) {
  //     //   console.log('Split in for partner');
  //     //   let objPartner = {};
  //     //   objPartner.appointmentDetails = appointmentDetails;
  //     //   objPartner.payNow = payNow;
  //     //   objPartner.platformCharge = platformCharge;
  //     //   objPartner.paymentIntent = paymentIntent;
  //     //   objPartner.partner_referral_code = userClinic.partner_referral_code;
  //     //   await stripeHelperController.stripePaymentSplitPartnerSave(objPartner);
  //     // }

  //     appointmentDetails.status = 1;
  //     appointmentDetails.fullyPaid = doingFullPayment;
  //     await appointmentDetails.save();
  //     const response = {
  //       price: payNow,
  //       message: doingFullPayment
  //         ? `You will be charged $${payNow}`
  //         : `You will be charged $${payNow} which is the appointment fee. Remaining amount will be charged within 24 hours of the appointment time.`,
  //     };
  //     res.send(successResponse(response));
  //   } catch (e) {
  //     res.status(422).send(errorResponse({ message: 'Payment failed!', error: e }));
  //   }
  // },

  // stripePaymentSplitDetailsSave: async (data) => {
  //   const userDoctor = await models.user.findOne({
  //     attributes: ['paymentvia', 'email'],
  //     where: { id: data.appointmentDetails.practitioner_id },
  //   });

  //   let getPaymentviaDetails = await helper.getPaymentviaDetails(
  //     data.appointmentDetails.practiceId,
  //     data.appointmentDetails.practitioner_id
  //   );
  //   let paymentVia = 0;
  //   if (getPaymentviaDetails && getPaymentviaDetails.paymentvia) {
  //     paymentVia = getPaymentviaDetails.paymentvia;
  //   }
  //   const clinicStripeId = await stripeHelperController.getStripeAccount(data.appointmentDetails.practiceId);
  //   const doctorStripeId = await stripeHelperController.getStripeAccount(data.appointmentDetails.practitioner_id);
  //   const doctorPaymentPercentage = await models.doctor_appointment_payment_percentage.findOne({
  //     where: { clinicId: data.appointmentDetails.practiceId, doctorId: data.appointmentDetails.practitioner_id },
  //     order: [['id', 'DESC']],
  //   });
  //   let doctorPercentage = 0;
  //   let originalPercentage = 0;

  //   let isSplitOccur = 0;
  //   if (doctorStripeId && paymentVia == 1) {
  //     if (doctorPaymentPercentage) {
  //       doctorPercentage = Number(doctorPaymentPercentage.paymentPercentage) / 100; ////set as 60%
  //       originalPercentage = doctorPaymentPercentage.paymentPercentage;
  //     }
  //     //[0: paymentvia not set, 1: platform, 2: external]
  //     let doctotAccount = await stripeHelperController.getOnboardingAccount(doctorStripeId);
  //     if (doctotAccount?.external_accounts?.data?.length > 0) {
  //       isSplitOccur = 1;
  //     }
  //   }
  //   let stripeSetup = await stripeHelperController.getStripeSetup();
  //   const payoutDate = stripeSetup ? stripeSetup.paidoutDay : 7; //payoutDate set as 7 days
  //   const transactionLog = await models.transaction_log.findOne({
  //     where: { appointmentId: data.appointmentDetails.id },
  //     order: [['id', 'DESC']],
  //   });

  //   console.log('doctorPercentage', doctorPercentage);

  //   //let remaningAmount = Number(data.payNow) - Number(data.platformCharge); //old code
  //   let remaningAmount = Number(data.payNow);

  //   // this is use when payment is faild from cron then create manually next remaining payment
  //   if (data.isNextPayment == 1) {
  //     remaningAmount = data.payNow;
  //   }

  //   /**
  //    * For Clinic Split Data
  //    */
  //   let doctorAmount = Number(remaningAmount) * Number(doctorPercentage);
  //   console.log('doctorAmount', doctorAmount);
  //   console.log('remaningAmount', remaningAmount);

  //   let clinicAmount = Number(remaningAmount) - Number(doctorAmount);
  //   if (clinicAmount >= 1) {
  //     let clinicSplitObj = {};
  //     clinicSplitObj.userId = data.appointmentDetails.patient_id;
  //     clinicSplitObj.clinicDoctorId = data.appointmentDetails.practiceId || null; // clinic id
  //     clinicSplitObj.clinicId = data.appointmentDetails.practiceId || null; // clinic id
  //     clinicSplitObj.doctor_paymentvia = paymentVia;
  //     clinicSplitObj.splitAmount = clinicAmount;
  //     clinicSplitObj.paymentIntentId = data.paymentIntent.id;
  //     clinicSplitObj.transferGroupId = data.paymentIntent.transfer_group;
  //     clinicSplitObj.latestChargeId = data.paymentIntent.latest_charge;
  //     clinicSplitObj.appointmentId = data.appointmentDetails.id;
  //     clinicSplitObj.transactionId = transactionLog.id;
  //     clinicSplitObj.doctorPercentage = Number(100) - Number(originalPercentage);
  //     clinicSplitObj.amount = remaningAmount;
  //     clinicSplitObj.stripe_account_id = clinicStripeId;
  //     clinicSplitObj.payoutDate = moment().add(payoutDate, 'days');
  //     clinicSplitObj.splitType = 1; //1->clinic
  //     console.log('clinicSplitObj', clinicSplitObj);
  //     await stripeHelperController.createStripePaymentSplit(clinicSplitObj);
  //   }
  //   /**
  //    * For Doctor Split Data
  //    */
  //   if (doctorAmount >= 1 && isSplitOccur == 1 && originalPercentage > 0) {
  //     let doctorSplitObj = {};
  //     doctorSplitObj.userId = data.appointmentDetails.patient_id;
  //     doctorSplitObj.clinicId = data.appointmentDetails.practiceId || null; // clinic id
  //     doctorSplitObj.doctor_paymentvia = paymentVia;
  //     doctorSplitObj.clinicDoctorId = data.appointmentDetails.practitioner_id || null; // doctor id
  //     doctorSplitObj.splitAmount = doctorAmount;
  //     doctorSplitObj.paymentIntentId = data.paymentIntent.id;
  //     doctorSplitObj.transferGroupId = data.paymentIntent.transfer_group;
  //     doctorSplitObj.latestChargeId = data.paymentIntent.latest_charge;
  //     doctorSplitObj.appointmentId = data.appointmentDetails.id;
  //     doctorSplitObj.transactionId = transactionLog.id;
  //     doctorSplitObj.doctorPercentage = originalPercentage;
  //     doctorSplitObj.amount = remaningAmount;
  //     doctorSplitObj.stripe_account_id = doctorStripeId || null;
  //     doctorSplitObj.payoutDate = moment().add(payoutDate, 'days');
  //     doctorSplitObj.splitType = 2; //2->Doctor
  //     console.log('doctorSplitObj', doctorSplitObj);

  //     await stripeHelperController.createStripePaymentSplit(doctorSplitObj);
  //   }
  //   return true;
  // },

  // stripePaymentSplitPartnerSave: async (data) => {
  //   let getPaymentviaDetails = await helper.getPaymentviaDetails(
  //     data.appointmentDetails.practiceId,
  //     data.appointmentDetails.practitioner_id
  //   );
  //   let paymentVia = 0;
  //   if (getPaymentviaDetails && getPaymentviaDetails.paymentvia) {
  //     paymentVia = getPaymentviaDetails.paymentvia;
  //   }
  //   let stripeSetup = await stripeHelperController.getStripeSetup();
  //   let partnerStripe = await helper.getParnerHubData(data.partner_referral_code);
  //   let stripe_account_id = '';
  //   if (
  //     partnerStripe &&
  //     partnerStripe.partner &&
  //     partnerStripe.partner.stripe_account_id &&
  //     partnerStripe.partner.status == 1 &&
  //     partnerStripe.campaign &&
  //     partnerStripe.campaign.commission > 0 &&
  //     partnerStripe.campaign.commission < 5 &&
  //     stripeSetup.platfromCharge > partnerStripe.campaign.commission
  //   ) {
  //     stripe_account_id = partnerStripe.partner.stripe_account_id;
  //     const payoutDate = stripeSetup ? stripeSetup.paidoutDay : 7; //payoutDate set as 7 days

  //     const transactionLog = await models.transaction_log.findOne({
  //       where: { appointmentId: data.appointmentDetails.id },
  //       order: [['id', 'DESC']],
  //     });

  //     let partnerAmount = Number(partnerStripe.campaign.commission);

  //     let partnerSplitObj = {};
  //     partnerSplitObj.userId = data.appointmentDetails.patient_id;
  //     partnerSplitObj.clinicDoctorId = data.appointmentDetails.practiceId || null; // doctor id
  //     partnerSplitObj.splitAmount = partnerAmount;
  //     partnerSplitObj.clinicId = data.appointmentDetails.practiceId || null; // clinic id
  //     partnerSplitObj.doctor_paymentvia = paymentVia;
  //     partnerSplitObj.paymentIntentId = data.paymentIntent.id;
  //     partnerSplitObj.transferGroupId = data.paymentIntent.transfer_group;
  //     partnerSplitObj.latestChargeId = data.paymentIntent.latest_charge;
  //     partnerSplitObj.appointmentId = data.appointmentDetails.id;
  //     partnerSplitObj.transactionId = transactionLog.id;
  //     partnerSplitObj.doctorPercentage = 0;
  //     partnerSplitObj.amount = partnerStripe.campaign.commission;
  //     partnerSplitObj.partner_referral_code = data.partner_referral_code;
  //     partnerSplitObj.stripe_account_id = stripe_account_id || null;
  //     partnerSplitObj.payoutDate = moment().add(payoutDate, 'days');
  //     partnerSplitObj.splitType = 3; //3->partner
  //     console.log('partnerSplitObj', partnerSplitObj);

  //     await stripeHelperController.createStripePaymentSplit(partnerSplitObj);
  //   }

  //   return true;
  // },

  // stripePaymentSplitMerchantSave: async (data) => {
  //   let getPaymentviaDetails = await helper.getPaymentviaDetails(
  //     data.appointmentDetails.practiceId,
  //     data.appointmentDetails.practitioner_id
  //   );
  //   let paymentVia = 0;
  //   if (getPaymentviaDetails && getPaymentviaDetails.paymentvia) {
  //     paymentVia = getPaymentviaDetails.paymentvia;
  //   }
  //   let stripeSetup = await stripeHelperController.getStripeSetup();
  //   let partnerStripe = await helper.getParnerHubData(data.partner_referral_code);
  //   let partnerAmount = 0;
  //   if (partnerStripe && partnerStripe.partner && stripeSetup.platfromCharge > partnerStripe.campaign.commission) {
  //     partnerAmount = Number(partnerStripe.campaign.commission);
  //   }
  //   let partner_referral_code = '';
  //   if (partnerStripe && partnerStripe.partner && partnerStripe.partner.status == 1) {
  //     partner_referral_code = data.partner_referral_code;
  //   }
  //   const payoutDate = stripeSetup ? stripeSetup.paidoutDay : 7; //payoutDate set as 7 days

  //   const transactionLog = await models.transaction_log.findOne({
  //     where: { appointmentId: data.appointmentDetails.id },
  //     order: [['id', 'DESC']],
  //   });
  //   let totalFeeAmount = Number(transactionLog.stripeFee) / 100;
  //   let platformCharge = stripeSetup.platfromCharge;
  //   console.log(totalFeeAmount);
  //   console.log('transactionLog.stripeFee', transactionLog.stripeFee);
  //   let useAmount = (Number(totalFeeAmount) + Number(partnerAmount)).toFixed(2);
  //   console.log('useAmount', useAmount);
  //   let finalTotalAmount = Number(platformCharge) - Number(useAmount);
  //   console.log('finalTotalAmount', finalTotalAmount);
  //   let merchantSplitObj = {};
  //   merchantSplitObj.userId = data.appointmentDetails.patient_id;
  //   merchantSplitObj.clinicDoctorId = 0; // merchant id
  //   merchantSplitObj.splitAmount = platformCharge;
  //   merchantSplitObj.clinicId = data.appointmentDetails.practiceId || null; // clinic id
  //   merchantSplitObj.doctor_paymentvia = paymentVia;
  //   merchantSplitObj.paymentIntentId = data.paymentIntent.id;
  //   merchantSplitObj.latestChargeId = data.paymentIntent.latest_charge;
  //   merchantSplitObj.appointmentId = data.appointmentDetails.id;
  //   merchantSplitObj.transactionId = transactionLog.id;
  //   merchantSplitObj.doctorPercentage = 0;
  //   merchantSplitObj.amount = 0;
  //   merchantSplitObj.partnerHubAmount = 0;
  //   merchantSplitObj.stripeFeeAmount = totalFeeAmount;
  //   merchantSplitObj.partner_referral_code = partner_referral_code;
  //   merchantSplitObj.payoutDate = moment().add(payoutDate, 'days');
  //   merchantSplitObj.splitType = 4; //4->MerchantPayout
  //   console.log('merchantSplitObj', merchantSplitObj);

  //   await stripeHelperController.createStripePaymentSplit(merchantSplitObj);

  //   return true;
  // },

  // payoutForMerchantAccount: async (paymentMerchant) => {
  //   try {
  //     if (paymentMerchant.length > 0) {
  //       let currentDate = moment(new Date()).format('YYYY-MM-DD');

  //       paymentMerchant.forEach(async function (details) {
  //         console.log('payoutData For merchant===', details.payoutDate, '------currentDate===', currentDate);
  //         console.log(details.splitAmount);
  //         let balance = await stripe.balance.retrieve();
  //         let availableBalance = balance.available.find((o) => o.currency == 'aud');
  //         console.log(availableBalance);
  //         let stripeSetup = await stripeHelperController.getStripeSetup();
  //         let partnerStripe = await helper.getParnerHubData(details.partner_referral_code);
  //         let partnerAmount = 0;
  //         const refunds = await models.refunds.findOne({
  //           where: { appointment_id: details.appointmentId },
  //           order: [['id', 'DESC']],
  //         });

  //         if (
  //           !refunds &&
  //           partnerStripe &&
  //           partnerStripe.partner &&
  //           stripeSetup.platfromCharge > partnerStripe.campaign.commission
  //         ) {
  //           partnerAmount = Number(partnerStripe.campaign.commission);
  //         }

  //         const transactionLog = await models.transaction_log.findOne({
  //           where: { appointmentId: details.appointmentId },
  //           order: [['id', 'DESC']],
  //         });
  //         let totalFeeAmount = Number(transactionLog.stripeFee) / 100;
  //         let platformCharge = stripeSetup.platfromCharge;
  //         console.log(totalFeeAmount);
  //         console.log('transactionLog.stripeFee', transactionLog.stripeFee);
  //         let useAmount = (Number(totalFeeAmount) + Number(partnerAmount)).toFixed(2);
  //         console.log('useAmount', useAmount);
  //         let finalTotalAmount = (Number(platformCharge) - Number(useAmount)).toFixed(2);
  //         console.log('finalTotalAmount', finalTotalAmount);
  //         if (availableBalance.amount > 0 && availableBalance.amount >= details.splitAmount) {
  //           await stripe.payouts
  //             .create({
  //               amount: Number(finalTotalAmount) * 100,
  //               currency: 'aud',
  //             })
  //             .then(async (result) => {
  //               details.stripeTransferId = result.id;
  //               details.status = 1;
  //               details.amount = platformCharge;
  //               details.partnerHubAmount = partnerAmount;
  //               details.stripeFeeAmount = totalFeeAmount;
  //               await details.save();
  //             })
  //             .catch(async (err) => {
  //               console.log('err', err);
  //               details.status = 3;
  //               details.paymentFaildMessage = err.message;
  //               await details.save();
  //             });
  //         }
  //       });
  //     }
  //   } catch (error) { }
  // },

  // nextPayment: async (req, res) => {
  //   const appointmentDetails = await models.appointment.findByPk(req.body.appointmentId[0]);
  //   if (!appointmentDetails || appointmentDetails.fullyPaid == 1)
  //     return res.status(422).send(errorResponse('Appointment not found'));

  //   const price = await stripeHelperController.getAppointmentPricing(appointmentDetails);
  //   if (price < 0.1) {
  //     appointmentDetails.fullyPaid = 4;
  //     await appointmentDetails.save();
  //     return res.send(successResponse({ message: 'This appointment is free!', price: 0 }));
  //   }

  //   const userStripeId = await stripeHelperController.getStripeAccount(req.authUser.id);
  //   const clinicStripeId = await stripeHelperController.getStripeAccount(appointmentDetails.practiceId);

  //   const transactionLog = await models.transaction_log.findOne({
  //     where: { appointmentId: appointmentDetails.id },
  //     order: [['id', 'DESC']],
  //   });
  //   if (!transactionLog)
  //     return res.status(422).send(errorResponse('No previous transaction found for this appointment!'));
  //   const paymentIntentDataFirst = await stripe.paymentIntents.retrieve(transactionLog.data);

  //   const payNow = Math.floor(transactionLog.balanceTransaction - transactionLog.amount);
  //   try {
  //     const defaultPaymentMethod = await stripeHelperController.getDefaultPaymentMethod(req.authUser.id);
  //     if (!defaultPaymentMethod) return res.send(errorResponse('No default payment method attached!'));

  //     const doctorDetails = await models.user.findOne({
  //       attributes: ['name', 'email'],
  //       where: { id: appointmentDetails.practitioner_id },
  //     });
  //     let description = `Booking with ${doctorDetails.name}`;

  //     const paymentIntent = await stripe.paymentIntents.create({
  //       amount: payNow * 100,
  //       currency: 'aud',
  //       customer: userStripeId,
  //       payment_method: defaultPaymentMethod,
  //       off_session: true,
  //       description: description,
  //       confirm: true,
  //       transfer_group: 'group_transfer_' + Date.now(),

  //       // application_fee_amount: payNow * 10,
  //       // transfer_data: {
  //       //   destination: clinicStripeId,
  //       // },
  //     });
  //     /**
  //      * payment split to clinic and doctor
  //      */

  //     let obj = {};
  //     obj.appointmentDetails = appointmentDetails;
  //     obj.payNow = payNow;
  //     obj.paymentIntent = paymentIntent;
  //     obj.isNextPayment = 1;
  //     await stripeHelperController.stripePaymentSplitDetailsSave(obj);

  //     // //  console.log(`appointment.id: ${appointment.id}, userStripeId: ${userStripeId}, clinicStripeId: ${clinicStripeId}, defaultPaymentMethod: ${defaultPaymentMethod}, transactionLog: ${transactionLog}, price: ${price} `);
  //     appointmentDetails.fullyPaid = 1;
  //     transactionLog.nextPayment = paymentIntent.id;
  //     let amountAdd = Number(transactionLog.amount) + Number(payNow);
  //     transactionLog.amount = amountAdd;
  //     await appointmentDetails.save();
  //     await transactionLog.save();
  //     return res.send(successResponse(`You have been charged $${payNow} as apointment price.`));
  //   } catch (e) {
  //     res.status(422).send(errorResponse({ message: 'Payment failed!', error: e }));
  //   }
  // },

  // getOnboardingAccount: async (stripe_account_id) => {
  //   try {
  //     const stripeAccId = stripe_account_id;
  //     let resData = await stripe.accounts.retrieve(stripeAccId);
  //     return resData;
  //   } catch (err) {
  //     return err.message;
  //   }
  // },

  /**
  developerTestFunction: async(req, res) => {
    const pm = "pm_1M99OfL2fhd8w8tClrP75FfU";
    const customer = "cus_MsvE7iJnVJwOrF"
 
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 10099,
        currency: 'aud',
        customer: customer,
        payment_method: pm,
        off_session: true,
        confirm: true,
      });
    } catch (err) {
      // Error code will be authentication_required if authentication is needed
      console.log('Error code is: ', err.code);
      // const paymentIntentRetrieved = await stripe.paymentIntents.retrieve(err.raw.payment_intent.id);
      // console.log('PI retrieved: ', paymentIntentRetrieved.id);
    }
 
    return res.send(successResponse("ok"))
  },
  */

  // getAppointmentPricing: async function (appointmentDetails) {
  //   const doctorAppointmentTypeCharge = await models.doctors_appointment_type.findOne({
  //     where: {
  //       appointmentTypeId: appointmentDetails.apptTypeId,
  //       clinicId: appointmentDetails.practiceId,
  //       doctorId: appointmentDetails.practitioner_id,
  //     },
  //   });
  //   return parseFloat(doctorAppointmentTypeCharge ? doctorAppointmentTypeCharge.pricing : 50);
  // },

  getStripeAccount: async function (userId) {
    const userInfo = await user.findById(userId);
    let stripe_account_id = userInfo.stripe_account_id;
    if (!stripe_account_id) {
      const newStripeAccountId: any = await stripeHelperController.createCustomer(userInfo);
      stripe_account_id = newStripeAccountId.id;
      updateAccount(stripe_account_id, userId);
    }
    return stripe_account_id;
  },

  // getDefaultPaymentMethod: async function (userId) {
  //   const user = await models.user.findOne({
  //     attributes: ['defaultPaymentMethod'],
  //     where: {
  //       id: userId,
  //     },
  //   });
  //   const defaultPaymentMethod = user.defaultPaymentMethod;
  //   return defaultPaymentMethod;
  // },

  // webhook: async (req, res) => {
  //   // Check the webhook signature against our private signing secret
  //   const webhookSignature = req.headers['stripe-signature'];
  //   const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  //   //// console.log(webhookSignature )
  //   //// console.log('webhookSecret', endpointSecret )
  //   //  console.log('req.body', req.body )
  //   let event;
  //   try {
  //     event = stripe.webhooks.constructEvent(req.rawBody, webhookSignature, endpointSecret);
  //   } catch (e) {
  //     // // console.log(e.message);
  //     return res.status(400).send(`Webhook error: ${e.message}`);
  //   }
  //   // The account.updated event is sent to this webhook endpoint whenever a connected account is updated.
  //   // Handle the event

  //   if (event.type == 'account.updated') {
  //     const account = event.data.object;
  //     ////console.log("account updated", account);
  //     try {
  //       // Find the pilot with the connected account ID
  //       const user = await models.User.findOne({
  //         stripe_account_id: account.id,
  //       });

  //       // For unverified pilots, check if Stripe is notifying us that they're now verified (and payouts are enabled)
  //       if (!user.stripeVerified && account.verification.status === 'verified' && account.payouts_enabled) {
  //         // Record them as verified
  //         console.log(`Webhook event: new verified pilot - ${user}`);
  //         user.stripeVerified = true;
  //         await user.save();
  //         return res.sendStatus(200);
  //       }
  //     } catch (e) {
  //       console.log(`Unknown pilot with account ID ${account.id}`);
  //     }
  //   } else if (event.type.split('.')[0] == 'payment_intent') {
  //     await handleWebhookEvent(event);
  //     return res.sendStatus(200);
  //   }
  //   // Stripe needs to receive a 200 status from any webhooks endpoint
  //   res.sendStatus(400);
  // },

  // retrivePaymentIntent: async (req, res) => {
  //   try {
  //     const paymentIntent = await stripe.paymentIntents.retrieve(req.body.intentId);
  //     return res.send(
  //       successResponse({
  //         invoice: paymentIntent.charges.data[0].receipt_url,
  //         payment_method: paymentIntent.charges.data[0].payment_method_details,
  //       })
  //     );
  //   } catch (error) {
  //     return res.send(errorResponse('Invalid intentId'));
  //   }
  // },

  // getPaymentByDoctor: async (appoinmentId) => {
  //   const appointment = await models.appointment.findOne({
  //     where: {
  //       id: appoinmentId,
  //       status: { [Op.notIn]: [2, 4, 5, 9, 10, 11] },
  //       fullyPaid: { [Op.notIn]: [1, 4] },
  //     },
  //   });
  //   const patient = await models.user.findOne({
  //     attributes: ['name', 'email', 'countryCode', 'phnMobile', 'stripe_account_id', 'defaultPaymentMethod'],
  //     where: { id: appointment.patient_id },
  //   });
  //   try {
  //     const userStripeId = patient.stripe_account_id; // //await STRIPE.getStripeAccount(appointment.patient_id)
  //     // // const clinicStripeId = await STRIPE.getStripeAccount(appointment.practiceId)
  //     const clinicStripeId = await stripeHelperController.getStripeAccount(appointment.practiceId);
  //     const doctorStripeId = await stripeHelperController.getStripeAccount(appointment.practitioner_id);
  //     const defaultPaymentMethod = patient.defaultPaymentMethod; // //await STRIPE.getDefaultPaymentMethod(appointment.patient_id)
  //     const transactionLog = await models.transaction_log.findOne({
  //       where: { appointmentId: appointment.id },
  //       order: [['id', 'DESC']],
  //     });
  //     if (!transactionLog) {
  //       return { message: 'No previous transaction found for this appointment!', error: e, status: 1 };
  //     }
  //     const price = Math.floor(transactionLog.balanceTransaction - transactionLog.amount);
  //     if (price < 0.1) {
  //       appointment.fullyPaid = 4;
  //       await appointment.save();
  //       return { message: 'This appointment is free!', status: 0 };
  //     }
  //     const doctorDetails = await models.user.findOne({
  //       attributes: ['name', 'email'],
  //       where: { id: appointment.practitioner_id },
  //     });
  //     let description = `Booking with ${doctorDetails.name}`;
  //     const paymentIntent = await stripe.paymentIntents.create({
  //       amount: price * 100,
  //       currency: 'aud',
  //       customer: userStripeId,
  //       payment_method: defaultPaymentMethod,
  //       off_session: true,
  //       confirm: true,
  //       description: description,
  //       transfer_group: 'group_transfer_' + Date.now(),
  //       // // transfer_data: {
  //       // //     destination: clinicStripeId,
  //       // // }
  //     });

  //     let obj = {};
  //     obj.appointmentDetails = appointment;
  //     obj.payNow = price;
  //     obj.platformCharge = 0;
  //     obj.paymentIntent = paymentIntent;
  //     obj.isNextPayment = 1;
  //     await stripeHelperController.stripePaymentSplitDetailsSave(obj);

  //     // //  console.log(`appointment.id: ${appointment.id}, userStripeId: ${userStripeId}, clinicStripeId: ${clinicStripeId}, defaultPaymentMethod: ${defaultPaymentMethod}, transactionLog: ${transactionLog}, price: ${price} `);
  //     let amountAdd = Number(transactionLog.amount) + Number(price);
  //     transactionLog.amount = amountAdd;
  //     appointment.fullyPaid = 1;
  //     transactionLog.nextPayment = paymentIntent.id;
  //     await appointment.save();
  //     await transactionLog.save();
  //     return { message: 'Payment success!', status: 0 };
  //   } catch (error) {
  //     appointment.fullyPaid = 2;
  //     await appointment.save();
  //     // send email and sms to patients
  //     const message = `Auto deduction is failed for your appointment. Open ${process.env.DASHBOARD_DEEPLINK} to view appointments - Team DoctorScan.`;
  //     if (patient.phnMobile) {
  //       await helper.sendMessage(patient.countryCode + patient.phnMobile, message);
  //     }
  //     let mailObj = {
  //       email: patient.email,
  //       subject: 'Auto-charge Failed',
  //       data: {
  //         name: patient.name,
  //         url: process.env.DASHBOARD_DEEPLINK,
  //       },
  //     };
  //     await helper.mailSentBySendgrid(mailObj, 'payment-failed');
  //     await NOTIFY.partialPaymentFailed(appointment);
  //     return { message: 'Payment failed!', error: e, status: 1 };
  //   }
  // },
};
const updateAccount = async (accountId, userId) => {
  // models.user.update(
  //   { stripe_account_id: accountId },
  //   {
  //     where: {
  //       id: userId,
  //     },
  //   },
  //   { returning: true }
  // );

  return await user.findByIdAndUpdate(userId, { is_registered_with_stript: true, stripe_account_id: accountId });
  // if (!updatedUserInfo) {
  //   return ResponseBuilder.data([], "User not found");
  // }
};

async function generateAccountLink(accountID, origin, authUserData, returnUrl = '') {
  // if (origin.match(/localhost/)) this.origin = origin;
  // else {
  //   origin = process.env.CLIENT_URL;
  // }
  const path = 'dashboard';
  // let linkUrl = returnUrl !== '' ? returnUrl : origin + '/' + path;
  let linkUrl = process.env.CLIENT_URL + '/' + path;
  // const token = helper.generateAuthToken({
  //   id: authUserData.id,
  //   type: 'registration',
  //   user_type: authUserData.user_type,
  // });
  return stripe.accountLinks
    .create({
      type: 'account_onboarding',
      account: accountID,
      refresh_url: `${linkUrl}?refresh=true`,
      return_url: `${linkUrl}?`,
      // return_url: `${linkUrl}?` + token,
      collect: 'currently_due',
    })
    .then((link) => link.url);
}
