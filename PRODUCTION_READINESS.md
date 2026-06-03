# Production Readiness & Security Assessment

**Current Date:** April 18, 2026  
**Status:** ⚠️ **NOT PRODUCTION READY** - Critical security issues identified

---

## 🔴 CRITICAL ISSUES (Must Fix Before Production)

### 1. **Exposed Secrets in Codebase**
**Risk Level:** 🔴 CRITICAL

**Current State:**
- JWT_SECRET hardcoded fallback: `'super-secret-key-for-samqtex'`
- Database credentials in .env visible in repo
- API keys (Gemini, Stripe, M-PESA) exposed

**Production Solution:**
```bash
# Use environment-only secrets (never in code)
# Implement secret management:
# Option A: AWS Secrets Manager
# Option B: HashiCorp Vault
# Option C: Azure Key Vault
# Option D: Kubernetes Secrets (if containerized)
```

**Implementation Files to Update:**
- `server.ts` (lines 16-19): Remove hardcoded defaults
- `.env.example`: Never commit real credentials

---

### 2. **CORS Vulnerability**
**Risk Level:** 🔴 CRITICAL

**Current State (server.ts line 145):**
```typescript
cors: { origin: "*" }  // ❌ INSECURE
```

**Production Fix:**
```typescript
const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',');
cors: { 
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id']
}
```

---

### 3. **Data Validation & Regional Compliance**
**Risk Level:** 🔴 CRITICAL

**Current State:**
- No email format validation
- No phone format validation by region
- VARCHAR(50) for phone allows invalid formats
- No rate limiting on authentication

**Production Implementation:**

```typescript
// validators.ts (NEW FILE)
import { z } from 'zod';

// Regional phone formats
const PHONE_PATTERNS = {
  'KE': /^(\+254|0)[17]\d{8}$/,  // Kenya: +254 or 0 + 1 or 7 + 8 digits
  'UG': /^(\+256|0)[73]\d{8}$/,  // Uganda: +256 or 0 + 7 or 3 + 8 digits
  'TZ': /^(\+255|0)[67]\d{8}$/,  // Tanzania: +255 or 0 + 6 or 7 + 8 digits
  'US': /^(\+1)?[2-9]\d{2}[2-9](?!11)\d{2}\d{4}$/,  // US
  'UK': /^(\+44|0)[1-9]\d{9,10}$/, // UK
  'INT': /^\+[1-9]\d{1,14}$/  // International E.164
};

export const ValidationSchemas = {
  email: z.string().email().trim().toLowerCase(),
  
  phone: (region: string = 'INT') => 
    z.string()
      .regex(PHONE_PATTERNS[region] || PHONE_PATTERNS.INT)
      .transform(p => p.replace(/\D/g, '')), // Strip formatting
  
  password: z.string()
    .min(12, "Password must be at least 12 characters")
    .regex(/[A-Z]/, "Must contain uppercase letter")
    .regex(/[a-z]/, "Must contain lowercase letter")
    .regex(/[0-9]/, "Must contain number")
    .regex(/[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>\/?]/, "Must contain special character"),
  
  username: z.string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_-]+$/, "Alphanumeric and underscores only"),
};

// Usage in auth endpoint
const phoneSchema = ValidationSchemas.phone(region);
const validPhone = phoneSchema.parse(clientPhone);
```

---

### 4. **Default Credentials**
**Risk Level:** 🔴 CRITICAL

**Current Issue:**
- Default admin password hardcoded: `'SamQtex+123'`
- Anyone with source code access knows default password

**Production Solution:**

```typescript
// server.ts - Bootstrap section
async function initializeFirstAdmin() {
  const adminExists = await db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  
  if (!adminExists) {
    // ONLY in development/first-run
    if (process.env.NODE_ENV === 'production') {
      console.error('❌ PRODUCTION: No admin found. Use CLI tool to create admin.');
      process.exit(1);
    }
    
    // Generate secure temporary password
    const tempPassword = crypto.randomBytes(12).toString('base64');
    const hash = bcrypt.hashSync(tempPassword, 12);
    
    await db.execute(
      'INSERT INTO users (tenant_id, username, name, email, password, role, is_first_login) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [1, 'admin', 'Administrator', 'admin@samqtex.local', hash, 'admin', true]
    );
    
    console.log(`\n⚠️  SETUP REQUIRED\nTemporary Admin Password: ${tempPassword}\nChange immediately after first login\n`);
  }
}
```

---

### 5. **JWT Security Issues**
**Risk Level:** 🔴 CRITICAL

**Current State:**
- No refresh token mechanism
- Token revocation not implemented
- Secret could be stronger

**Production Implementation:**

```typescript
// auth.ts (enhance)
interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function generateTokens(user: any): TokenPair {
  const accessToken = jwt.sign(
    { id: user.id, role: user.role, tenant_id: user.tenant_id },
    process.env.JWT_SECRET!,
    { expiresIn: '15m' }  // Short-lived access token
  );
  
  const refreshToken = jwt.sign(
    { id: user.id, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: '7d' }  // Longer-lived refresh token
  );
  
  return { accessToken, refreshToken, expiresIn: 900 };
}

// Token blacklist for logout
const tokenBlacklist = new Set<string>();

app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) tokenBlacklist.add(token);
  res.json({ success: true });
});
```

---

### 6. **Payment Security**
**Risk Level:** 🔴 CRITICAL

**Current Issues:**
- Stripe keys exposed in .env
- No PCI compliance measures
- Poor payment data handling

**Production Solution:**

```typescript
// payments.ts (NEW FILE)
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-04-10'
});

app.post('/api/payments/create-session', authMiddleware, async (req, res) => {
  try {
    const { amount, appointmentId, description } = req.body;
    
    // Validate amount (prevent tampering)
    if (amount < 100) return res.status(400).json({ error: 'Minimum amount is $1' });
    if (amount > 1000000) return res.status(400).json({ error: 'Amount exceeds maximum' });
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: description },
          unit_amount: amount
        },
        quantity: 1
      }],
      mode: 'payment',
      customer: req.user.id.toString(), // Tokenize customer
      client_reference_id: appointmentId,
      success_url: `${process.env.APP_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/cancel`,
    });
    
    res.json({ sessionUrl: session.url, sessionId: session.id });
  } catch (error: any) {
    console.error('Payment error:', error.message);
    res.status(500).json({ error: 'Payment processing failed' });
  }
});

// Webhook to handle payment completion
app.post('/api/payments/webhook', (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;
  
  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      // Update appointment/order status to 'paid'
      updatePaymentStatus(session.client_reference_id, 'paid');
    }
    
    res.json({ received: true });
  } catch (error: any) {
    res.status(400).json({ error: `Webhook Error: ${error.message}` });
  }
});
```

**PCI Compliance:**
- ✅ Never store card data locally
- ✅ Use Stripe.js for tokenization
- ✅ Implement webhooks for payment confirmation
- ✅ Use 3D Secure for additional security

---

### 7. **M-PESA Integration (Production)**
**Risk Level:** 🟡 HIGH

**Current State:** Test credentials, incomplete implementation

**Production Solution:**

```typescript
// mpesa.ts (ENHANCED)
import crypto from 'crypto';

class MpesaClient {
  private consumerKey = process.env.MPESA_CONSUMER_KEY!;
  private consumerSecret = process.env.MPESA_CONSUMER_SECRET!;
  private shortcode = process.env.MPESA_SHORTCODE!;
  private passkey = process.env.MPESA_PASSKEY!;
  private sandbox = process.env.NODE_ENV !== 'production';
  
  async initateSTKPush(phone: string, amount: number, accountRef: string) {
    try {
      // Get OAuth token first
      const token = await this.getAccessToken();
      
      // Create timestamp
      const timestamp = new Date().toISOString().replace(/[:\-]/g, '').split('.')[0];
      
      // Create password (Base64(shortcode+passkey+timestamp))
      const password = Buffer.from(
        `${this.shortcode}${this.passkey}${timestamp}`
      ).toString('base64');
      
      const payload = {
        BusinessShortCode: this.shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: amount,
        PartyA: this.sanitizePhone(phone),
        PartyB: this.shortcode,
        PhoneNumber: this.sanitizePhone(phone),
        CallBackURL: `${process.env.APP_URL}/api/payments/mpesa/callback`,
        AccountReference: accountRef.substring(0, 12), // Max 12 chars
        TransactionDesc: 'Service Payment'
      };
      
      const response = await fetch(
        this.sandbox
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
      
      return await response.json();
    } catch (error) {
      console.error('STK Push failed:', error);
      throw error;
    }
  }
  
  private sanitizePhone(phone: string): string {
    // Remove +, spaces, dashes
    let cleaned = phone.replace(/[\s\-+]/g, '');
    // Convert 0 to 254 for Kenya
    if (cleaned.startsWith('0')) cleaned = '254' + cleaned.substring(1);
    return cleaned;
  }
  
  private async getAccessToken(): Promise<string> {
    const auth = Buffer.from(
      `${this.consumerKey}:${this.consumerSecret}`
    ).toString('base64');
    
    const response = await fetch(
      this.sandbox
        ? 'https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials'
        : 'https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials',
      {
        headers: { Authorization: `Basic ${auth}` }
      }
    );
    
    const data = await response.json();
    return data.access_token;
  }
}
```

---

### 8. **Rate Limiting & Brute Force Protection**
**Risk Level:** 🟡 HIGH

**Current State:** None implemented

**Production Solution:**

```typescript
// middleware/rateLimiter.ts (NEW)
import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many login attempts. Please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Don't rate limit from admin IP (if known)
    return process.env.ADMIN_IP && req.ip === process.env.ADMIN_IP;
  }
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests. Please try again later.'
});

// Apply to auth routes
app.post('/api/auth/login', authLimiter, async (req, res) => {
  // ... login logic
});

app.use('/api/', apiLimiter);
```

---

### 9. **Data Retention & GDPR Compliance**
**Risk Level:** 🟡 HIGH

**Current State:** 60-day auto-delete is implemented

**Production Enhancements:**

```typescript
// compliance.ts (NEW)
export const DataRetentionPolicies = {
  // GDPR Article 17: Right to be forgotten
  async deleteUserData(userId: number, tenantId: number) {
    try {
      // Anonymize personal data
      await db.execute(
        'UPDATE users SET email=?, phone=?, name=?, bio=? WHERE id=?',
        ['[deleted]', '[deleted]', '[deleted]', null, userId]
      );
      
      // Delete sensitive logs
      await db.execute(
        'DELETE FROM logs WHERE worker_id=?', [userId]
      );
      
      // Anonymize orders
      await db.execute(
        'UPDATE orders SET client_phone=?, client_name=? WHERE user_id=?',
        ['[deleted]', '[deleted]', userId]
      );
      
      console.log(`User ${userId} data deleted from tenant ${tenantId}`);
    } catch (error) {
      console.error('Data deletion failed:', error);
      throw error;
    }
  },
  
  // Ensure old data is purged
  setupAutoRetention() {
    cron.schedule('0 0 * * *', async () => {
      const retentionDays = process.env.DATA_RETENTION_DAYS || 60;
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
      
      await db.execute(
        'DELETE FROM logs WHERE created_at < ? AND tenant_id NOT IN (SELECT tenant_id FROM subscriptions WHERE status="active")',
        [cutoffDate]
      );
    });
  }
};
```

---

### 10. **API Input Validation & SQL Injection Prevention**
**Risk Level:** 🔴 CRITICAL

**Current State:** Using parameterized queries (✅), but no request body validation

**Production Solution:**

```typescript
// middleware/validation.ts (NEW)
import { body, validationResult } from 'express-validator';

export const validateAuthLogin = [
  body('identifier')
    .trim()
    .notEmpty().withMessage('Email/Username/Phone required')
    .isLength({ min: 3, max: 255 }).withMessage('Invalid format'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password too short'),
  body('tenant_id')
    .trim()
    .isNumeric().withMessage('Invalid tenant'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];

export const validatePhoneNumber = [
  body('phone')
    .trim()
    .matches(/^[\+\d\-\s\(\)]+$/).withMessage('Invalid phone format')
    .isLength({ min: 7, max: 20 }).withMessage('Invalid phone length'),
];

// Usage
app.post('/api/auth/login', validateAuthLogin, async (req, res) => {
  // ... safe to use req.body
});
```

---

### 11. **Encryption for Sensitive Data**
**Risk Level:** 🟡 HIGH

**Implementation:**

```typescript
// security/encryption.ts (NEW)
import crypto from 'crypto';

class EncryptionService {
  private encryptionKey = Buffer.from(process.env.ENCRYPTION_KEY || 'default-key', 'hex');
  
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return `${iv.toString('hex')}:${encrypted}`;
  }
  
  decrypt(ciphertext: string): string {
    const [ivHex, encryptedHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

// Use for sensitive phone/email in database
const encryptor = new EncryptionService();

// When storing
const encryptedPhone = encryptor.encrypt(phone);
await db.execute('INSERT INTO users (phone) VALUES (?)', [encryptedPhone]);

// When retrieving
const user = await db.prepare('SELECT phone FROM users WHERE id = ?').get(userId);
const decryptedPhone = encryptor.decrypt(user.phone);
```

---

## 📋 PRODUCTION CHECKLIST

### Infrastructure & Deployment
- [ ] Use HTTPS/TLS everywhere (not HTTP)
- [ ] Database connection uses SSL
- [ ] Separate secrets management (AWS Secrets Manager, Vault, etc.)
- [ ] Environment variables properly configured per environment
- [ ] Database backups automated daily
- [ ] Monitoring & alerting set up (e.g., Datadog, New Relic)
- [ ] CI/CD pipeline with automated tests
- [ ] Docker/container security scanning

### Application Security
- [ ] All secrets removed from codebase
- [ ] CORS properly configured (no wildcard origins)
- [ ] CSRF protection enabled
- [ ] XSS protection implemented
- [ ] SQL injection prevention (using parameterized queries) ✅
- [ ] Rate limiting on authentication endpoints
- [ ] API rate limiting globally
- [ ] Request size limits enforced
- [ ] HTTPS/TLS enforced
- [ ] Security headers added (CSP, X-Frame-Options, etc.)

### Authentication & Authorization
- [ ] Password complexity requirements enforced
- [ ] MFA/2FA implemented for admin users
- [ ] JWT tokens with short expiration (15-30 min access, 7d refresh)
- [ ] Token revocation mechanism
- [ ] Secure session management
- [ ] Audit logging for all auth events

### Data Protection
- [ ] Encryption at rest for sensitive data
- [ ] Encryption in transit (TLS)
- [ ] PII data minimization
- [ ] Data retention policies enforced
- [ ] GDPR/Regional compliance audit
- [ ] Database credentials not in any visible config
- [ ] API keys rotated regularly

### Payment & Financial Security
- [ ] PCI-DSS compliance verified
- [ ] No card data stored locally
- [ ] Stripe/Payment tokens used
- [ ] Webhook signatures validated
- [ ]3D Secure implemented
- [ ] Payment reconciliation automated
- [ ] Fraud detection rules enabled

### Testing & Quality
- [ ] Security testing (OWASP Top 10)
- [ ] Penetration testing completed
- [ ] Load testing (stress test your system)
- [ ] Backup restoration tested
- [ ] Disaster recovery plan documented
- [ ] All dependencies scanned for vulnerabilities

### Compliance & Legal
- [ ] Privacy policy documented
- [ ] Terms of service reviewed
- [ ] Data processing agreements (DPA) in place
- [ ] Cookie consent implemented
- [ ] Regional regulations checked (Kenya, Uganda, Tanzania, etc.)

---

## 🔧 QUICK SETUP COMMANDS

```bash
# 1. Generate strong secrets
openssl rand -base64 32  # For JWT_SECRET
openssl rand -hex 32     # For ENCRYPTION_KEY

# 2. Install security packages
npm install express-validator express-rate-limit helmet cors

# 3. Update environment
# CREATE .env.production with secure values (NEVER commit)
# Use secrets manager for deployment

# 4. Enable HTTPS locally
# For development with self-signed cert:
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# 5. Run security audit
npm audit
npm audit fix

# 6. Set up monitoring
# Implement error tracking (Sentry, LogRocket, etc.)
```

---

## 🚨 DEPLOYMENT WARNINGS

### NEVER in Production:
```
❌ Default passwords
❌ Test API keys
❌ Hardcoded secrets
❌ CORS origin "*"
❌ SQL errors in responses
❌ Stack traces visible
❌ Debug mode enabled
❌ Unencrypted connections
❌ Unauthenticated endpoints
```

### ALWAYS in Production:
```
✅ Environment-only secrets
✅ HTTPS/TLS everywhere
✅ Rate limiting
✅ Input validation
✅ Comprehensive logging
✅ Error monitoring
✅ Database backups
✅ Audit trails
✅ MFA for admins
```

---

## 📞 SUPPORT & RESOURCES

- **OWASP Top 10:** https://owasp.org/www-project-top-ten/
- **Node.js Security:** https://nodejs.org/en/docs/guides/security/
- **Stripe API Docs:** https://stripe.com/docs
- **PCI Compliance:** https://www.pcisecuritystandards.org/
- **Regional Regulations:**
  - Kenya: https://www.icta.go.ke/
  - Uganda: https://www.ict.go.ug/
  - Tanzania: https://www.tcra.go.tz/

---

**Last Updated:** April 18, 2026  
**Next Review:** Before any production deployment
