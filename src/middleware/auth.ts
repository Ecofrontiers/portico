/**
 * API Key Authentication Middleware
 *
 * When auth.enabled is true, requires a valid Bearer token
 * on all inference endpoints. Health and status endpoints
 * are always open (for monitoring).
 *
 * Keys can be set in portico.yml or via PORTICO_API_KEYS env var.
 *
 * Ecofrontiers SARL, AGPL-3.0
 */

import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!config.auth?.enabled) {
    return next();
  }

  // Health and status are always open
  if (req.path === '/health' || req.path === '/status') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: {
        message: 'Missing or invalid Authorization header. Expected: Bearer <api-key>',
        type: 'authentication_error',
      },
    });
    return;
  }

  const token = authHeader.slice(7);
  const validKeys = config.auth.keys || [];

  if (!validKeys.includes(token)) {
    res.status(403).json({
      error: {
        message: 'Invalid API key.',
        type: 'authentication_error',
      },
    });
    return;
  }

  next();
}
