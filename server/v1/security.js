import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { firebaseAuth } from '../firebase.js';
import { logger } from '../logger.js';

const roles = new Set(['admin', 'tecnico', 'operacional', 'leitura']);

function jwtSecret() {
  return process.env.APP_JWT_SECRET || 'corretivas-dev-secret-change-me';
}

export function normalizeRole(role) {
  return roles.has(role) ? role : 'leitura';
}

export function signApiToken(user) {
  return jwt.sign(
    {
      sub: user.uid,
      email: user.email,
      name: user.name,
      role: normalizeRole(user.role),
    },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '12h' },
  );
}

export async function verifyApiToken(token) {
  const auth = firebaseAuth();

  if (auth) {
    try {
      const decoded = await auth.verifyIdToken(token);
      return {
        uid: decoded.uid,
        email: decoded.email,
        name: decoded.name || decoded.email,
        role: normalizeRole(decoded.role || decoded.perfil || decoded.customClaims?.role),
        provider: 'firebase',
      };
    } catch (error) {
      logger.debug({ error: error.message }, 'Token Firebase invalido, tentando JWT local');
    }
  }

  const decoded = jwt.verify(token, jwtSecret());
  return {
    uid: decoded.sub,
    email: decoded.email,
    name: decoded.name || decoded.email,
    role: normalizeRole(decoded.role),
    provider: 'jwt',
  };
}

export function requireAuth(requiredRoles = []) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';

      if (!token) {
        res.status(401).json({ error: 'Token de autenticacao ausente.' });
        return;
      }

      const user = await verifyApiToken(token);
      const allowed = requiredRoles.length === 0 || requiredRoles.includes(user.role) || user.role === 'admin';

      if (!allowed) {
        res.status(403).json({ error: 'Permissao insuficiente.' });
        return;
      }

      req.user = user;
      next();
    } catch (_error) {
      res.status(401).json({ error: 'Sessao invalida ou expirada.' });
    }
  };
}

export async function validateLocalPassword(password) {
  const hash = process.env.LOCAL_ADMIN_PASSWORD_HASH;

  if (hash) {
    return bcrypt.compare(password, hash);
  }

  return Boolean(process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD);
}
