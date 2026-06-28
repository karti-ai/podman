import { clerkMiddleware, getAuth } from '@clerk/express';
import type { Request, RequestHandler, Response } from 'express';
import { env } from './env.js';

export interface RequestUserContext {
  clerkUserId: string;
}

export const clerkAuthMiddleware: RequestHandler = env.CLERK_SECRET_KEY
  ? clerkMiddleware()
  : (_req, _res, next) => next();

export function requestUser(req: Request): RequestUserContext | null {
  if (!env.CLERK_SECRET_KEY) return null;
  try {
    const auth = getAuth(req);
    return auth.isAuthenticated && auth.userId ? { clerkUserId: auth.userId } : null;
  } catch {
    return null;
  }
}

export function requireRequestUser(req: Request, res: Response): RequestUserContext | null {
  const user = requestUser(req);
  if (!user) {
    res.status(401).json({ error: 'sign in required' });
    return null;
  }
  return user;
}
