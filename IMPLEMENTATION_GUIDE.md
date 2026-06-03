# Production Security Implementation Guide

**Date:** April 18, 2026  
**Status:** Implementation Guide for Production Readiness

---

## Overview

This guide explains how to integrate the security modules created in `src/security/` into your existing application for production readiness.

**Security Files Created:**
1. `src/security/validators.ts` - Input validation & sanitization
2. `src/security/encryption.ts` - Data encryption for PII
3. `src/security/payments.ts` - Secure payment processing
4. `src/security/auth.ts` - Authentication & rate limiting

---

## 1. Integration with `server.ts`

### 1.1 Update Imports

```typescript
// At the top of server.ts
import { 
  AuthManager, 
  RateLimiter, 
  SessionManager,
  createAuthMiddleware,
  createRateLimitMiddleware
} from './src/security/auth';
import { Validator, sanitizeMiddleware, validateRequest } from './src/security/validators';
import { getEncryptor, EncryptedDatabase } from './src/security/encryption';
import { PaymentProcessor, StripePaymentHandler, MpesaPaymentHandler } from './src/security/payments';
```

### 1.2 Initialize Security Modules

```typescript
async function startServer() {
  // Initialize security managers
  const authManager = new AuthManager(
    process.env.JWT_SECRET,
    process.env.JWT_REFRESH_SECRET
  );
  const rateLimiter = new RateLimiter(5, 15 * 60 * 1000); // 5 attempts in 15 minutes
  const sessionManager = new SessionManager();
  const encryptor = getEncryptor();
  const paymentProcessor = new PaymentProcessor();

  // ... rest of bootstrap code
  
  app.use(sanitizeMiddleware); // Sanitize all inputs first
  app.use(createRateLimitMiddleware(rateLimiter)); // Rate limiting on all routes
}
```

### 1.3 Update Authentication Endpoint

**BEFORE (server.ts ~line 207):**
```typescript
app.post("/api/auth/login", async (req: any, res) => {
  try {
    const { identifier, password, tenant_id, portal } = req.body;
    const user = await db.prepare('SELECT * FROM users WHERE (email = ? OR username = ? OR phone = ?) AND tenant_id = ?').get(identifier, identifier, identifier, tenant_id);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    // ...
```

**AFTER:**
```typescript
app.post("/api/auth/login", async (req: any, res) => {
  try {
    const { identifier, password, tenant_id, portal } = req.body;
    
    // Rate limiting
    const ipAddress = req.ip;
    if (rateLimiter.isLimited(ipAddress)) {
      return res.status(429).json({ 
        error: 'Too many login attempts. Try again later.',
        remaining: rateLimiter.getRemainingAttempts(ipAddress)
      });
    }

    // Validate input
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    // Query user (identifier can be email, username, or phone)
    let user = await db.prepare(
      'SELECT * FROM users WHERE email = ? AND tenant_id = ? LIMIT 1'
    ).get(identifier, tenant_id);
    
    if (!user) {
      user = await db.prepare(
        'SELECT * FROM users WHERE username = ? AND tenant_id = ? LIMIT 1'
      ).get(identifier, tenant_id);
    }
    
    if (!user) {
      user = await db.prepare(
        'SELECT * FROM users WHERE phone = ? AND tenant_id = ? LIMIT 1'
      ).get(Validator.validatePhone(identifier) || identifier, tenant_id);
    }

    if (!user) {
      // Don't reveal whether user exists
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Use authManager for password comparison
    const passwordValid = await authManager.comparePassword(password, user.password);
    if (!passwordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check role restrictions
    if (portal === 'admin' && user.role !== 'admin') {
      return res.status(403).json({ error: "Restricted to Administrators" });
    }
    if (portal === 'worker' && user.role === 'client') {
      return res.status(403).json({ error: "Restricted to Staff" });
    }

    // Generate token pair
    const tokens = authManager.generateTokens({
      id: user.id,
      role: user.role,
      tenant_id: user.tenant_id
    });

    // Create session
    const sessionId = sessionManager.createSession(
      user.id,
      ipAddress,
      req.get('user-agent') || ''
    );

    // Log login activity
    const logDetails = `Logged In to ${portal || 'App'} from ${ipAddress}`;
    const logHash = await generateLogHash(tenant_id, logDetails);
    await db.prepare(
      'INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(tenant_id, user.id, 'Auth', logDetails, logHash);

    // Remove sensitive fields
    const { password: _, ...userWithoutPassword } = user;

    // Return tokens (client stores in localStorage/httpOnly cookies)
    res.json({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      user: userWithoutPassword
    });

    rateLimiter.reset(ipAddress); // Reset on successful login
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: "Login failed" });
  }
});
```

### 1.4 Add Token Refresh Endpoint

```typescript
app.post("/api/auth/refresh", async (req: any, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token' });
    }

    const newTokens = authManager.refreshAccessToken(refreshToken);
    
    if (!newTokens) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    res.json({
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      expiresIn: newTokens.expiresIn
    });
  } catch (error: any) {
    res.status(500).json({ error: "Token refresh failed" });
  }
});
```

### 1.5 Add Logout Endpoint

```typescript
app.post("/api/auth/logout", createAuthMiddleware(authManager), async (req: any, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (token) {
      authManager.revokeToken(token);
    }

    const logDetails = `Logged Out`;
    const logHash = await generateLogHash(req.user.tenant_id, logDetails);
    await db.prepare(
      'INSERT INTO logs (tenant_id, worker_id, action, details, log_hash) VALUES (?, ?, ?, ?, ?)'
    ).run(req.user.tenant_id, req.user.id, 'Auth', logDetails, logHash);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Logout failed" });
  }
});
```

### 1.6 Update Protected Routes

Replace all protected endpoints with:

```typescript
app.get("/api/admin/dashboard", createAuthMiddleware(authManager), async (req: any, res) => {
  try {
    // req.user is now validated
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    // ... rest of endpoint
  } catch (error) {
    res.status(500).json({ error: "Request failed" });
  }
});
```

---

## 2. Integration with Payments (`server.ts` ~line 750+)

### 2.1 Update Order Creation Endpoint

**BEFORE:**
```typescript
app.post("/api/orders", guestMiddleware, async (req: any, res) => {
  try {
    const { items, total_amount, payment_method, client_name, client_phone, type } = req.body;
    // ...
```

**AFTER:**
```typescript
app.post("/api/orders", guestMiddleware, async (req: any, res) => {
  try {
    const { items, total_amount, payment_method, client_name, client_phone, type } = req.body;
    const tenantId = req.tenantId || '1';
    const userId = req.user?.id || null;

    // Validate phone number
    const validPhone = Validator.validatePhone(client_phone, 'KE');
    if (!validPhone) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Validate amount
    if (total_amount < 1 || total_amount > 999999) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Check stock
    for (const item of items) {
      const product = await db.prepare('SELECT stock FROM products WHERE id = ?').get(item.id);
      if (!product || Number(product.stock) < item.quantity) {
        return res.status(400).json({ error: `Insufficient stock for item ${item.id}` });
      }
    }

    // Create order
    const orderResult = await db.prepare(`
      INSERT INTO orders (tenant_id, user_id, client_name, client_phone, total_amount, payment_method, payment_status, status, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tenantId, 
      userId, 
      Validator.sanitizeString(client_name),
      validPhone,
      total_amount,
      payment_method,
      payment_method === 'Cash' ? 'paid' : 'unpaid',
      'pending',
      type || 'online'
    );

    // Process payment if needed
    if (payment_method === 'Stripe') {
      const paymentHandler = new StripePaymentHandler();
      const intent = await paymentHandler.createPaymentIntent(
        Math.round(total_amount * 100), // Convert to cents
        'usd',
        { orderId: orderResult.lastInsertRowid.toString() }
      );
      
      return res.json({ 
        success: true, 
        orderId: orderResult.lastInsertRowid,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret
      });
    }

    if (payment_method === 'M-Pesa') {
      const mpesaHandler = new MpesaPaymentHandler();
      const mpesaResult = await mpesaHandler.initiateStkPush(
        validPhone,
        total_amount * 100, // M-Pesa expects cents
        `ORD${orderResult.lastInsertRowid}`
      );

      if (mpesaResult.success) {
        await db.execute(
          'UPDATE orders SET checkout_request_id = ? WHERE id = ?',
          [mpesaResult.checkoutRequestId, orderResult.lastInsertRowid]
        );
      }

      return res.json({
        success: true,
        orderId: orderResult.lastInsertRowid,
        ...mpesaResult
      });
    }

    // Cash payment - complete immediately
    await db.execute(
      'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
      ['paid', 'completed', orderResult.lastInsertRowid]
    );

    res.json({ success: true, orderId: orderResult.lastInsertRowid });
  } catch (error: any) {
    console.error('Order creation error:', error);
    res.status(500).json({ error: "Order creation failed" });
  }
});
```

### 2.2 Add Payment Webhook Handler

```typescript
app.post("/api/payments/webhook/stripe", express.raw({type: 'application/json'}), async (req: any, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const stripeHandler = new StripePaymentHandler();
    
    const event = stripeHandler.verifyWebhookSignature(req.body, sig);

    if (event.type === 'payment_intent.succeeded') {
      const intent = event.data.object as any;
      const orderId = intent.metadata?.orderId;

      if (orderId) {
        await db.execute(
          'UPDATE orders SET payment_status = ?, status = ? WHERE id = ?',
          ['paid', 'completed', orderId]
        );

        console.log(`✅ Payment confirmed for order ${orderId}`);
      }
    }

    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/payments/webhook/mpesa", express.json(), async (req: any, res) => {
  try {
    const mpesaHandler = new MpesaPaymentHandler();

    // Validate callback signature
    if (!mpesaHandler.validateCallbackSignature(req.body, req.headers['Authorization'] || '')) {
      return res.status(400).json({ error: 'Invalid callback' });
    }

    const { Body } = req.body;
    const { stkCallback } = Body;

    if (stkCallback.ResultCode === 0) {
      // Payment successful
      const callbackMetadata = stkCallback.CallbackMetadata.Item;
      const amount = callbackMetadata.find((item: any) => item.Name === 'Amount')?.Value;
      const mpesaReceiptNumber = callbackMetadata.find((item: any) => item.Name === 'MpesaReceiptNumber')?.Value;
      const transactionDate = callbackMetadata.find((item: any) => item.Name === 'TransactionDate')?.Value;
      const phoneNumber = callbackMetadata.find((item: any) => item.Name === 'PhoneNumber')?.Value;

      // Find order by phone and amount
      const order = await db.prepare(
        'SELECT id FROM orders WHERE client_phone = ? AND total_amount = ? AND payment_status = ? ORDER BY created_at DESC LIMIT 1'
      ).get(phoneNumber, amount, 'unpaid');

      if (order) {
        await db.execute(
          'UPDATE orders SET payment_status = ?, status = ?, transaction_id = ? WHERE id = ?',
          ['paid', 'completed', mpesaReceiptNumber, order.id]
        );

        console.log(`✅ M-Pesa payment confirmed: ${mpesaReceiptNumber}`);
      }
    } else {
      console.warn(`❌ M-Pesa payment failed: ${stkCallback.ResultDesc}`);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Callback processed' });
  } catch (error: any) {
    console.error('M-Pesa webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
```

---

## 3. Environment Variables Setup

Add these to `.env` (REPLACE with real values):

```bash
# ===== SECURITY =====
JWT_SECRET=your-super-secret-key-min-32-chars-here-randomized
JWT_REFRESH_SECRET=another-super-secret-key-different-from-above
ENCRYPTION_KEY=your-encryption-key-in-hex-format-64-chars

# ===== CORS =====
CORS_ORIGINS=http://localhost:3000,http://localhost:5173,https://yourdomain.com

# ===== STRIPE (Production Keys) =====
STRIPE_SECRET_KEY=sk_live_xxxxx  # NOT sk_test
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx

# ===== M-PESA (Production Credentials) =====
MPESA_CONSUMER_KEY=your-consumer-key
MPESA_CONSUMER_SECRET=your-consumer-secret
MPESA_SHORTCODE=000000  # Your actual shortcode
MPESA_PASSKEY=your-passkey

# ===== DATABASE =====
DB_HOST=your-prod-db-host
DB_USER=prod_user
DB_PASSWORD=very-strong-password-here
DB_NAME=samqtex_prod

# ===== ADMIN IP (Optional - bypass rate limiting) =====
ADMIN_IP=1.2.3.4

# ===== RETENTION =====
DATA_RETENTION_DAYS=60
```

---

## 4. Database Schema Updates

Add these columns to your database for enhanced security:

```sql
-- Add to users table
ALTER TABLE users ADD COLUMN failed_login_attempts INT DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_at TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN locked_until TIMESTAMP NULL;
ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN mfa_secret VARCHAR(255) NULL;

-- Add to orders table
ALTER TABLE orders ADD COLUMN checkout_request_id VARCHAR(255) NULL;
ALTER TABLE orders ADD COLUMN payment_intent_id VARCHAR(255) NULL;
ALTER TABLE orders ADD COLUMN transaction_id VARCHAR(255) NULL;

-- Add session logging
CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(255) PRIMARY KEY,
  user_id INT NOT NULL,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY (expires_at)
);
```

---

## 5. Testing Security Implementation

### 5.1 Test Rate Limiting

```bash
# Make 6 login attempts in quick succession
for i in {1..6}; do
  curl -X POST http://localhost:3000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"identifier":"admin","password":"wrong","tenant_id":"1","portal":"admin"}'
done
# Should return 429 Too Many Requests on 6th attempt
```

### 5.2 Test Input Validation

```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"items":[],"total_amount":0,"payment_method":"Cash","client_name":"<script>alert(1)</script>","client_phone":"invalid"}'
# Should reject XSS and invalid phone
```

### 5.3 Test Token Refresh

```bash
# Use refresh token to get new access token
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"your-refresh-token-here"}'
```

---

## 6. Deployment Checklist

**Before deploying to production:**

- [ ] All `.env` values are real (not test/placeholder values)
- [ ] Database backups are configured
- [ ] HTTPS/TLS certificate is valid
- [ ] CORS origins are NOT wildcards
- [ ] Rate limiting is enabled
- [ ] Stripe webhook is configured
- [ ] M-PESA credentials are verified
- [ ] Encryption key is generated and secured
- [ ] Monitoring/alerting is set up
- [ ] All secrets are in secure vault, not in code
- [ ] Database connection uses SSL
- [ ] Audit logging is enabled
- [ ] Payment reconciliation is tested

---

## 7. Continued Development

As more features are added:

1. Always use `Validator.validateSecurityThreats()` for user inputs
2. Always use `getEncryptor()` for sensitive data
3. Always use `createAuthMiddleware()` for protected routes
4. Always verify payment webhooks before updating status
5. Always log security events

---

**Need Help?**

- Check `PRODUCTION_READINESS.md` for detailed security guidance
- Review OWASP Top 10: https://owasp.org/www-project-top-ten/
- PCI Compliance: https://www.pcisecuritystandards.org/

**Last Updated:** April 18, 2026
