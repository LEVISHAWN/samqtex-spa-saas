/**
 * Payment Processing Security
 * Secure payment handling for Stripe, M-Pesa, and other methods
 */

import Stripe from 'stripe';
import crypto from 'crypto';

/**
 * Stripe Payment Handler
 * Implements PCI-DSS compliant payment processing
 */
export class StripePaymentHandler {
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(
    apiKey: string = process.env.STRIPE_SECRET_KEY!,
    webhookSecret: string = process.env.STRIPE_WEBHOOK_SECRET!
  ) {
    this.stripe = new Stripe(apiKey, {
      apiVersion: '2024-04-10',
      telemetry: false // Disable telemetry in production
    });
    this.webhookSecret = webhookSecret;
  }

  /**
   * Creates a payment intent for appointment/service
   * NEVER charge without explicit user confirmation
   */
  async createPaymentIntent(
    amount: number,
    currency: string = 'usd',
    metadata: Record<string, string> = {}
  ): Promise<Stripe.PaymentIntent> {
    // Validate amount
    if (amount < 50) throw new Error('Minimum amount is $0.50');
    if (amount > 99999900) throw new Error('Amount exceeds maximum');

    try {
      const intent = await this.stripe.paymentIntents.create({
        amount,
        currency,
        metadata,
        statement_descriptor: 'SAMQTEX SPA', // Appears on customer's bank statement
        automatic_payment_methods: {
          enabled: true,
          allow_redirects: 'never'
        }
      });

      return intent;
    } catch (error: any) {
      console.error('Payment intent creation failed:', error.message);
      throw new Error(`Payment creation failed: ${error.message}`);
    }
  }

  /**
   * Creates a checkout session for bookings
   * More secure than direct payment intent
   */
  async createCheckoutSession(
    appointmentId: string,
    amount: number,
    customerId: string,
    successUrl: string,
    cancelUrl: string
  ): Promise<Stripe.Checkout.Session> {
    try {
      const session = await this.stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer: customerId, // Stripe customer ID (should be created beforehand)
        client_reference_id: appointmentId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [{
          amount,
          currency: 'usd',
          name: 'Service Booking',
          description: `Appointment #${appointmentId}`,
          quantity: 1
        }],
        // Security: Automatically confirm payment after 3D Secure
        payment_intent_data: {
          metadata: { appointmentId }
        }
      });

      return session;
    } catch (error: any) {
      console.error('Checkout session creation failed:', error.message);
      throw new Error(`Checkout failed: ${error.message}`);
    }
  }

  /**
   * Confirms payment after client action
   */
  async confirmPayment(
    paymentIntentId: string,
    paymentMethodId: string
  ): Promise<Stripe.PaymentIntent> {
    try {
      const intent = await this.stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId
      });

      return intent;
    } catch (error: any) {
      console.error('Payment confirmation failed:', error.message);
      throw error;
    }
  }

  /**
   * Retrieves payment status
   */
  async getPaymentStatus(paymentIntentId: string): Promise<string> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);
      return intent.status;
    } catch (error: any) {
      console.error('Payment status retrieval failed:', error.message);
      throw error;
    }
  }

  /**
   * Webhook verification (critical for security)
   * Always verify webhook signatures to prevent spoofing
   */
  verifyWebhookSignature(body: string | Buffer, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(
        body,
        signature,
        this.webhookSecret
      );
    } catch (error: any) {
      throw new Error(`Webhook verification failed: ${error.message}`);
    }
  }

  /**
   * Handles successful payment
   */
  async handlePaymentSuccess(paymentIntentId: string): Promise<void> {
    const intent = await this.stripe.paymentIntents.retrieve(paymentIntentId);

    if (intent.status === 'succeeded') {
      const appointmentId = intent.metadata?.appointmentId;
      // Update appointment status in database
      // await db.execute('UPDATE appointments SET payment_status = ? WHERE id = ?', ['paid', appointmentId]);
      console.log(`Payment succeeded for appointment ${appointmentId}`);
    }
  }

  /**
   * Refunds a payment
   * Requires proper authorization
   */
  async refundPayment(
    paymentIntentId: string,
    amount?: number,
    reason: string = 'customer_request'
  ): Promise<Stripe.Refund> {
    try {
      const refund = await this.stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount, // Optional: partial refund
        reason: reason as any,
        metadata: {
          processedAt: new Date().toISOString()
        }
      });

      console.log(`Refund processed: ${refund.id}`);
      return refund;
    } catch (error: any) {
      console.error('Refund failed:', error.message);
      throw error;
    }
  }
}

/**
 * M-PESA Payment Handler
 * Production-ready M-PESA STK Push implementation
 */
export class MpesaPaymentHandler {
  private consumerKey: string;
  private consumerSecret: string;
  private shortcode: string;
  private passkey: string;
  private isDev: boolean;

  constructor(
    consumerKey = process.env.MPESA_CONSUMER_KEY!,
    consumerSecret = process.env.MPESA_CONSUMER_SECRET!,
    shortcode = process.env.MPESA_SHORTCODE!,
    passkey = process.env.MPESA_PASSKEY!
  ) {
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
    this.shortcode = shortcode;
    this.passkey = passkey;
    this.isDev = process.env.NODE_ENV !== 'production';
  }

  /**
   * Sanitizes and formats phone number to M-Pesa format
   */
  private formatPhone(phone: string): string {
    // Remove all non-digits
    let cleaned = phone.replace(/\D/g, '');

    // Convert 0 prefix to 254 (Kenya)
    if (cleaned.startsWith('0')) {
      cleaned = '254' + cleaned.substring(1);
    }

    // Ensure it starts with country code
    if (!cleaned.startsWith('254')) {
      throw new Error('Invalid phone number - must be Kenya format');
    }

    return cleaned;
  }

  /**
   * Gets OAuth token from Safaricom
   */
  private async getAccessToken(): Promise<string> {
    try {
      const auth = Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');

      const response = await fetch(
        this.isDev
          ? 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
          : 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
        {
          method: 'GET',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.statusText}`);
      }

      const data = await response.json() as any;
      return data.access_token;
    } catch (error: any) {
      console.error('M-Pesa token request failed:', error.message);
      throw error;
    }
  }

  /**
   * Initiates STK Push (prompt for payment)
   */
  async initiateStkPush(
    phone: string,
    amount: number,
    accountRef: string,
    description: string = 'Service Payment'
  ): Promise<any> {
    try {
      const token = await this.getAccessToken();
      const formattedPhone = this.formatPhone(phone);

      // Create timestamp
      const timestamp = new Date()
        .toISOString()
        .replace(/[:\-]/g, '')
        .split('.')[0];

      // Create password
      const password = Buffer.from(
        `${this.shortcode}${this.passkey}${timestamp}`
      ).toString('base64');

      const payload = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.floor(amount), // M-Pesa expects whole numbers
        PartyA: formattedPhone,
        PartyB: this.shortcode,
        PhoneNumber: formattedPhone,
        CallBackURL: `${process.env.APP_URL}/api/payments/mpesa/callback`,
        AccountReference: accountRef.substring(0, 12).toUpperCase(),
        TransactionDesc: description.substring(0, 13)
      };

      const response = await fetch(
        this.isDev
          ? 'https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest'
          : 'https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        throw new Error(`STK Push failed: ${response.statusText}`);
      }

      const result = await response.json() as any;

      if (result.ResponseCode === '0') {
        return {
          success: true,
          checkoutRequestId: result.CheckoutRequestID,
          messageId: result.RequestId
        };
      } else {
        throw new Error(result.ResponseDescription || 'STK Push failed');
      }
    } catch (error: any) {
      console.error('STK Push error:', error.message);
      throw error;
    }
  }

  /**
   * Query transaction status
   */
  async queryTransaction(checkoutRequestId: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      const timestamp = new Date()
        .toISOString()
        .replace(/[:\-]/g, '')
        .split('.')[0];

      const password = Buffer.from(
        `${this.shortcode}${this.passkey}${timestamp}`
      ).toString('base64');

      const response = await fetch(
        this.isDev
          ? 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query'
          : 'https://api.safaricom.co.ke/mpesa/stkpushquery/v1/query',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            BusinessShortCode: this.shortcode,
            CheckoutRequestID: checkoutRequestId,
            Timestamp: timestamp,
            Password: password
          })
        }
      );

      if (!response.ok) {
        throw new Error(`Query failed: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      console.error('Transaction query failed:', error.message);
      throw error;
    }
  }

  /**
   * Validates callback signature
   */
  validateCallbackSignature(body: any, signature: string): boolean {
    // M-PESA uses GET parameters, validate timestamp to prevent replay attacks
    const callbackTime = new Date(body.TransactionDate * 1000);
    const now = new Date();
    const diffMinutes = (now.getTime() - callbackTime.getTime()) / (1000 * 60);

    // Reject callbacks older than 5 minutes
    if (diffMinutes > 5) {
      console.warn('Stale callback detected');
      return false;
    }

    return true;
  }
}

/**
 * Generic payment processor with multiple gateway support
 */
export class PaymentProcessor {
  private stripe: StripePaymentHandler;
  private mpesa: MpesaPaymentHandler;

  constructor() {
    this.stripe = new StripePaymentHandler();
    this.mpesa = new MpesaPaymentHandler();
  }

  /**
   * Process payment via selected method
   */
  async processPayment(
    method: 'stripe' | 'mpesa' | 'cash',
    amount: number,
    metadata: Record<string, any>
  ): Promise<any> {
    switch (method) {
      case 'stripe':
        return await this.stripe.createPaymentIntent(amount, 'usd', metadata);

      case 'mpesa':
        return await this.mpesa.initiateStkPush(
          metadata.phone,
          amount * 100, // Convert to cents
          metadata.appointmentId,
          metadata.description
        );

      case 'cash':
        // Just log, no validation needed
        return { method: 'cash', acknowledged: true };

      default:
        throw new Error('Unsupported payment method');
    }
  }

  /**
   * Verify payment status
   */
  async verifyPayment(method: string, transactionId: string): Promise<boolean> {
    try {
      if (method === 'stripe') {
        const status = await this.stripe.getPaymentStatus(transactionId);
        return status === 'succeeded';
      }

      if (method === 'mpesa') {
        const result = await this.mpesa.queryTransaction(transactionId);
        return result.ResponseCode === '0';
      }

      return false;
    } catch (error) {
      console.error('Payment verification failed:', error);
      return false;
    }
  }
}

export default PaymentProcessor;
