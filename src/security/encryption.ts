/**
 * Encryption Service for Sensitive Data
 * Handles AES-256-GCM encryption for PII and sensitive information
 */

import crypto from 'crypto';

export class EncryptionService {
  private encryptionKey: Buffer;
  private algorithm = 'aes-256-gcm';
  private keyLength = 32; // 256 bits
  private saltLength = 32;
  private tagLength = 16;
  private ivLength = 16;

  constructor(masterKey?: string) {
    if (!masterKey) {
      masterKey = process.env.ENCRYPTION_KEY;
      if (!masterKey) {
        throw new Error('ENCRYPTION_KEY environment variable not set');
      }
    }

    // Derive key from master key using PBKDF2 for additional security
    this.encryptionKey = crypto.pbkdf2Sync(masterKey, 'salt', 100000, this.keyLength, 'sha256');
  }

  /**
   * Encrypts sensitive data
   * Returns encrypted data with IV and authentication tag
   */
  encrypt(plaintext: string): string {
    try {
      // Generate random IV
      const iv = crypto.randomBytes(this.ivLength);

      // Create cipher
      const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

      // Encrypt the data
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get authentication tag
      const authTag = cipher.getAuthTag();

      // Return: iv:authTag:ciphertext (all hex encoded)
      return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypts encrypted data
   */
  decrypt(encrypted: string): string {
    try {
      const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');

      if (!ivHex || !authTagHex || !ciphertextHex) {
        throw new Error('Invalid encrypted format');
      }

      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      const ciphertext = Buffer.from(ciphertextHex, 'hex');

      // Create decipher
      const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
      decipher.setAuthTag(authTag);

      // Decrypt
      let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Decryption failed - possible tampering detected');
    }
  }

  /**
   * Creates hash for data integrity checking
   */
  createHash(data: string): string {
    return crypto
      .createHash('sha256')
      .update(data)
      .digest('hex');
  }

  /**
   * Verifies hash for data integrity
   */
  verifyHash(data: string, hash: string): boolean {
    return this.createHash(data) === hash;
  }

  /**
   * Generates secure random token
   */
  generateToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Hashes password using bcrypt pattern but with crypto
   * For use when bcrypt is not available
   */
  hashPassword(password: string, iterations: number = 100000): string {
    const salt = crypto.randomBytes(this.saltLength);
    const hash = crypto.pbkdf2Sync(password, salt, iterations, this.keyLength, 'sha256');
    return `${salt.toString('hex')}:${hash.toString('hex')}`;
  }

  /**
   * Verifies password hash
   */
  verifyPasswordHash(password: string, storedHash: string, iterations: number = 100000): boolean {
    try {
      const [saltHex, hashHex] = storedHash.split(':');
      const salt = Buffer.from(saltHex, 'hex');
      const hash = crypto.pbkdf2Sync(password, salt, iterations, this.keyLength, 'sha256');
      return hash.toString('hex') === hashHex;
    } catch {
      return false;
    }
  }
}

/**
 * Sensitive data fields that should be encrypted in database
 */
export const SENSITIVE_FIELDS = [
  'phone',
  'email',
  'ssn',
  'credit_card',
  'bank_account',
  'id_number'
];

/**
 * Database encryption helper
 */
export class EncryptedDatabase {
  private encryptor: EncryptionService;

  constructor(masterKey?: string) {
    this.encryptor = new EncryptionService(masterKey);
  }

  /**
   * Encrypts sensitive fields before storing
   */
  encryptBeforeStore(data: Record<string, any>): Record<string, any> {
    const encrypted = { ...data };

    SENSITIVE_FIELDS.forEach(field => {
      if (encrypted[field] && typeof encrypted[field] === 'string') {
        encrypted[field] = this.encryptor.encrypt(encrypted[field]);
      }
    });

    return encrypted;
  }

  /**
   * Decrypts sensitive fields after retrieval
   */
  decryptAfterRetrieve(data: Record<string, any>): Record<string, any> {
    const decrypted = { ...data };

    SENSITIVE_FIELDS.forEach(field => {
      if (decrypted[field]) {
        try {
          decrypted[field] = this.encryptor.decrypt(decrypted[field]);
        } catch (error) {
          console.error(`Failed to decrypt ${field}:`, error);
          decrypted[field] = '[DECRYPTION_FAILED]';
        }
      }
    });

    return decrypted;
  }

  /**
   * Masks sensitive data for display (e.g., +254 *** *** 789)
   */
  maskSensitiveData(value: string, revealLength: number = 3): string {
    if (!value) return '';

    const length = value.length;
    if (length <= revealLength + 2) {
      return '[redacted]';
    }

    // Show first 2 chars and last revealLength chars
    return value.substring(0, 2) + '*'.repeat(length - revealLength - 2) + value.substring(length - revealLength);
  }
}

/**
 * Example usage in Express middleware
 */
export function encryptionMiddleware(encryptor: EncryptionService) {
  return (req: any, res: any, next: any) => {
    // Make encryptor available in request
    req.encryptor = encryptor;
    next();
  };
}

// Export singleton instance (use in most places)
let encryptor: EncryptionService;

export function getEncryptor(): EncryptionService {
  if (!encryptor) {
    encryptor = new EncryptionService();
  }
  return encryptor;
}
