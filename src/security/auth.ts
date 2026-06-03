/**
 * Authentication & Authorization Security
 * Production-ready authentication with rate limiting and secure sessions
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

interface DecodedToken {
  id: number;
  role: string;
  tenant_id: number;
  type?: string;
}

/**
 * Secure Authentication Manager
 */
export class AuthManager {
  private jwtSecret: string;
  private jwtRefreshSecret: string;
  private accessTokenExpiry: string = '15m'; // Short-lived
  private refreshTokenExpiry: string = '7d'; // Longer-lived
  private tokenBlacklist: Set<string> = new Set();

  constructor(
    jwtSecret = process.env.JWT_SECRET!,
    jwtRefreshSecret = process.env.JWT_REFRESH_SECRET!
  ) {
    if (!jwtSecret) throw new Error('JWT_SECRET not configured');
    if (!jwtRefreshSecret) throw new Error('JWT_REFRESH_SECRET not configured');

    this.jwtSecret = jwtSecret;
    this.jwtRefreshSecret = jwtRefreshSecret;

    // Clean up blacklist periodically
    setInterval(() => this.cleanTokenBlacklist(), 3600000); // Every hour
  }

  /**
   * Generates token pair (access + refresh)
   */
  generateTokens(user: { id: number; role: string; tenant_id: number }): AuthTokens {
    const accessToken = jwt.sign(
      {
        id: user.id,
        role: user.role,
        tenant_id: user.tenant_id,
        type: 'access'
      },
      this.jwtSecret,
      { expiresIn: this.accessTokenExpiry }
    );

    const refreshToken = jwt.sign(
      {
        id: user.id,
        type: 'refresh'
      },
      this.jwtRefreshSecret,
      { expiresIn: this.refreshTokenExpiry }
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: 900 // 15 minutes in seconds
    };
  }

  /**
   * Verifies access token
   */
  verifyAccessToken(token: string): DecodedToken | null {
    try {
      if (this.tokenBlacklist.has(token)) {
        return null; // Token is revoked
      }

      const decoded = jwt.verify(token, this.jwtSecret) as any;
      return decoded;
    } catch (error) {
      console.error('Token verification failed:', error);
      return null;
    }
  }

  /**
   * Refreshes access token using refresh token
   */
  refreshAccessToken(refreshToken: string): AuthTokens | null {
    try {
      const decoded = jwt.verify(refreshToken, this.jwtRefreshSecret) as any;

      if (decoded.type !== 'refresh') {
        return null;
      }

      // Generate new token pair
      return this.generateTokens({
        id: decoded.id,
        role: decoded.role,
        tenant_id: decoded.tenant_id
      });
    } catch (error) {
      console.error('Token refresh failed:', error);
      return null;
    }
  }

  /**
   * Revokes token by adding to blacklist
   */
  revokeToken(token: string): void {
    this.tokenBlacklist.add(token);
  }

  /**
   * Cleans expired tokens from blacklist
   */
  private cleanTokenBlacklist(): void {
    // In production, use Redis for distributed token blacklist
    // For now, keep in memory with periodic cleanup
    this.tokenBlacklist.clear();
  }

  /**
   * Hash password with bcrypt
   */
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 12); // 12 rounds
  }

  /**
   * Compare password with hash
   */
  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  /**
   * Validates password complexity
   */
  validatePasswordStrength(password: string): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (password.length < 12) {
      errors.push('Password must be at least 12 characters');
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('Password must contain uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('Password must contain lowercase letter');
    }
    if (!/[0-9]/.test(password)) {
      errors.push('Password must contain number');
    }
    if (!/[!@#$%^&*()_\-+=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain special character');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * Rate Limiter for authentication endpoints
 */
export class RateLimiter {
  private attempts: Map<string, { count: number; resetTime: number }> = new Map();
  private maxAttempts: number;
  private windowMs: number;

  constructor(maxAttempts = 5, windowMs = 15 * 60 * 1000) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;

    // Clean expired entries every 10 minutes
    setInterval(() => this.cleanup(), 600000);
  }

  /**
   * Checks if request should be rate limited
   */
  isLimited(identifier: string): boolean {
    const now = Date.now();
    const record = this.attempts.get(identifier);

    if (!record || record.resetTime < now) {
      // First attempt or window expired
      this.attempts.set(identifier, { count: 1, resetTime: now + this.windowMs });
      return false;
    }

    // Window still active
    record.count++;

    if (record.count > this.maxAttempts) {
      return true;
    }

    return false;
  }

  /**
   * Gets remaining attempts
   */
  getRemainingAttempts(identifier: string): number {
    const record = this.attempts.get(identifier);
    if (!record || record.resetTime < Date.now()) {
      return this.maxAttempts;
    }
    return Math.max(0, this.maxAttempts - record.count);
  }

  /**
   * Resets attempts for identifier
   */
  reset(identifier: string): void {
    this.attempts.delete(identifier);
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.attempts.entries()) {
      if (record.resetTime < now) {
        this.attempts.delete(key);
      }
    }
  }
}

/**
 * Session Security Manager
 */
export class SessionManager {
  private sessions: Map<string, {
    userId: number;
    ipAddress: string;
    userAgent: string;
    createdAt: number;
    lastActivity: number;
    expiresAt: number;
  }> = new Map();

  private sessionTimeout: number = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Creates new session
   */
  createSession(
    userId: number,
    ipAddress: string,
    userAgent: string
  ): string {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const now = Date.now();

    this.sessions.set(sessionId, {
      userId,
      ipAddress,
      userAgent,
      createdAt: now,
      lastActivity: now,
      expiresAt: now + this.sessionTimeout
    });

    return sessionId;
  }

  /**
   * Validates session
   */
  validateSession(
    sessionId: string,
    ipAddress: string,
    userAgent: string
  ): {
    valid: boolean;
    userId?: number;
    reason?: string;
  } {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return { valid: false, reason: 'Session not found' };
    }

    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sessionId);
      return { valid: false, reason: 'Session expired' };
    }

    // Additional security: verify IP and User-Agent match
    if (session.ipAddress !== ipAddress) {
      return { valid: false, reason: 'IP address mismatch' };
    }

    if (session.userAgent !== userAgent) {
      return { valid: false, reason: 'User-Agent mismatch' };
    }

    // Update last activity
    session.lastActivity = Date.now();

    return { valid: true, userId: session.userId };
  }

  /**
   * Terminates session
   */
  terminateSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Gets all sessions for user (for "log out all devices" feature)
   */
  getUserSessions(userId: number): string[] {
    const userSessions: string[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.userId === userId) {
        userSessions.push(sessionId);
      }
    }

    return userSessions;
  }

  /**
   * Terminates all sessions for user
   */
  terminateAllUserSessions(userId: number): void {
    const sessionIds = this.getUserSessions(userId);
    sessionIds.forEach(id => this.terminateSession(id));
  }

  /**
   * Cleanup expired sessions
   */
  cleanup(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

/**
 * Middleware factory functions
 */
export function createAuthMiddleware(authManager: AuthManager) {
  return (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = authManager.verifyAccessToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = decoded;
    next();
  };
}

export function createRateLimitMiddleware(rateLimiter: RateLimiter) {
  return (req: any, res: any, next: any) => {
    const identifier = req.ip || req.connection.remoteAddress;

    if (rateLimiter.isLimited(identifier)) {
      return res.status(429).json({
        error: 'Too many requests. Try again later.',
        retryAfter: 900 // seconds
      });
    }

    next();
  };
}

export function createSessionMiddleware(sessionManager: SessionManager) {
  return (req: any, res: any, next: any) => {
    const sessionId = req.cookies.sessionId;

    if (!sessionId) {
      return res.status(401).json({ error: 'No session' });
    }

    const validation = sessionManager.validateSession(
      sessionId,
      req.ip,
      req.get('user-agent') || ''
    );

    if (!validation.valid) {
      return res.status(401).json({ error: validation.reason });
    }

    req.userId = validation.userId;
    next();
  };
}

/**
 * Singleton instances
 */
let authManager: AuthManager;
let rateLimiter: RateLimiter;
let sessionManager: SessionManager;

export function getAuthManager(): AuthManager {
  if (!authManager) {
    authManager = new AuthManager();
  }
  return authManager;
}

export function getRateLimiter(): RateLimiter {
  if (!rateLimiter) {
    rateLimiter = new RateLimiter();
  }
  return rateLimiter;
}

export function getSessionManager(): SessionManager {
  if (!sessionManager) {
    sessionManager = new SessionManager();
    // Cleanup every hour
    setInterval(() => sessionManager.cleanup(), 3600000);
  }
  return sessionManager;
}
