/**
 * Input Validation & Data Sanitization
 * Validates user input for security and regional compliance
 */

import { z } from 'zod';

// Regional phone number patterns
const PHONE_PATTERNS: Record<string, RegExp> = {
  'KE': /^(\+254|0)[17]\d{8}$/,      // Kenya: +254 or 0 + 1 or 7 + 8 digits
  'UG': /^(\+256|0)[73]\d{8}$/,      // Uganda: +256 or 0 + 7 or 3 + 8 digits
  'TZ': /^(\+255|0)[67]\d{8}$/,      // Tanzania: +255 or 0 + 6 or 7 + 8 digits
  'RW': /^(\+250|0)[7]\d{8}$/,       // Rwanda: +250 or 0 + 7 + 8 digits
  'SG': /^(\+65)?[6-9]\d{7}$/,       // Singapore
  'US': /^(\+1)?[2-9]\d{2}[2-9](?!11)\d{2}\d{4}$/,  // USA
  'UK': /^(\+44|0)[1-9]\d{9,10}$/,   // UK
  'INT': /^\+[1-9]\d{1,14}$/         // International E.164
};

export const ValidationSchemas = {
  // Email validation
  email: z.string()
    .email('Invalid email format')
    .trim()
    .toLowerCase()
    .max(255, 'Email too long'),
  
  // Regional phone validation
  phone: (region: string = 'INT') => {
    const pattern = PHONE_PATTERNS[region] || PHONE_PATTERNS.INT;
    return z.string()
      .regex(pattern, `Invalid phone format for ${region}`)
      .transform((p) => {
        // Normalize phone number
        let normalized = p.replace(/\D/g, '');
        if (region === 'KE' && normalized.startsWith('0')) {
          normalized = '254' + normalized.substring(1);
        }
        return normalized;
      });
  },
  
  // Strong password validation
  password: z.string()
    .min(12, 'Password must be at least 12 characters')
    .max(128, 'Password too long')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[a-z]/, 'Must contain lowercase letter')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>\/?]/, 'Must contain special character'),
  
  // Username validation
  username: z.string()
    .min(3, 'Username too short')
    .max(20, 'Username too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Only alphanumeric, underscore, and hyphen allowed'),
  
  // Name validation
  name: z.string()
    .min(2, 'Name too short')
    .max(100, 'Name too long')
    .regex(/^[a-zA-Z\s'-]+$/, 'Name contains invalid characters'),
  
  // Amount validation (in cents)
  amount: z.number()
    .min(100, 'Minimum amount is $1.00')
    .max(999999900, 'Amount exceeds maximum')
    .int('Amount must be in cents'),
  
  // Tenant ID validation
  tenantId: z.string()
    .or(z.number())
    .refine((val) => {
      const num = typeof val === 'string' ? parseInt(val) : val;
      return num > 0 && num < 1000000;
    }, 'Invalid tenant ID'),
  
  // Date validation
  date: z.string()
    .refine((val) => !isNaN(Date.parse(val)), 'Invalid date format'),
  
  // URL validation
  url: z.string()
    .url('Invalid URL format')
    .max(2048, 'URL too long'),
};

export class Validator {
  /**
   * Validates and sanitizes email
   */
  static validateEmail(email: string): string | null {
    try {
      return ValidationSchemas.email.parse(email);
    } catch (error) {
      return null;
    }
  }

  /**
   * Validates and normalizes phone number
   */
  static validatePhone(phone: string, region: string = 'INT'): string | null {
    try {
      return ValidationSchemas.phone(region).parse(phone);
    } catch (error) {
      return null;
    }
  }

  /**
   * Validates password strength
   */
  static validatePassword(password: string): boolean {
    try {
      ValidationSchemas.password.parse(password);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validates username format
   */
  static validateUsername(username: string): boolean {
    try {
      ValidationSchemas.username.parse(username);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sanitizes user input (remove dangerous characters)
   */
  static sanitizeString(input: string): string {
    return input
      .trim()
      .replace(/[<>\"\']/g, '')
      .substring(0, 1000); // Max length
  }

  /**
   * Detects common SQL injection patterns
   */
  static checkSQLInjection(input: string): boolean {
    const sqlPatterns = [
      /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE)\b)/gi,
      /(-{2}|\/\*|\*\/|;|\|{2}|&&)/,
      /(\bOR\b.*=.*|1\s*=\s*1)/gi,
    ];
    
    return sqlPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Detects common XSS patterns
   */
  static checkXSS(input: string): boolean {
    const xssPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /on\w+\s*=/gi,
      /javascript:/gi,
      /<iframe/gi,
      /<object/gi,
      /<embed/gi,
    ];
    
    return xssPatterns.some(pattern => pattern.test(input));
  }

  /**
   * Validates all user inputs for security
   */
  static validateSecurityThreats(input: string): { safe: boolean; threat?: string } {
    if (this.checkSQLInjection(input)) {
      return { safe: false, threat: 'SQL injection detected' };
    }
    
    if (this.checkXSS(input)) {
      return { safe: false, threat: 'XSS attack detected' };
    }
    
    return { safe: true };
  }
}

/**
 * Express middleware for input validation
 */
export function validateRequest(schema: Record<string, z.ZodType>) {
  return (req: any, res: any, next: any) => {
    try {
      const validated = Object.entries(schema).reduce((acc, [key, validator]) => {
        if (req.body[key] !== undefined) {
          acc[key] = validator.parse(req.body[key]);
        }
        return acc;
      }, {} as Record<string, any>);
      
      req.validatedBody = validated;
      next();
    } catch (error: any) {
      return res.status(400).json({
        error: 'Validation failed',
        details: error.errors?.map((e: any) => ({
          field: e.path.join('.'),
          message: e.message
        }))
      });
    }
  };
}

export function sanitizeMiddleware(req: any, res: any, next: any) {
  // Sanitize all string inputs
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        const sanitized = Validator.sanitizeString(req.body[key]);
        
        // Check for security threats
        const threat = Validator.validateSecurityThreats(sanitized);
        if (!threat.safe) {
          return res.status(400).json({ error: threat.threat });
        }
        
        req.body[key] = sanitized;
      }
    });
  }
  
  next();
}
