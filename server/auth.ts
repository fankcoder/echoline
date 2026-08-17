import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyRequest } from 'fastify';
import type { EchoDatabase } from './db.js';

const scrypt = promisify(scryptCallback);
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type OAuthProvider = 'github' | 'google';
type OAuthProfile = { subject: string; email: string; displayName: string; avatarUrl: string | null };

function appBasePath() {
  const value = process.env.APP_BASE_PATH ?? '/';
  if (!value || value === '/') return '';
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

function configuredOrigin(request: FastifyRequest) {
  const configured = (process.env.PUBLIC_ORIGIN || '').split(',').map((value) => value.trim()).find(Boolean);
  if (configured) return configured.replace(/\/$/, '');
  const protocol = request.headers['x-forwarded-proto']?.toString().split(',')[0] || request.protocol;
  return `${protocol}://${request.headers.host}`;
}

function callbackUrl(provider: OAuthProvider, request: FastifyRequest) {
  return `${configuredOrigin(request)}${appBasePath()}/api/auth/${provider}/callback`;
}

function config(provider: OAuthProvider) {
  if (provider === 'github') {
    const clientId = process.env.GITHUB_CLIENT_ID || '';
    const clientSecret = process.env.GITHUB_CLIENT_SECRET || '';
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

function text(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }

export function isOAuthNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const cause = error.cause instanceof Error ? `${error.cause.name} ${error.cause.message}` : '';
  return /fetch failed|timeout|econnreset|econnrefused|enotfound|ehostunreach/i.test(`${error.name} ${error.message} ${cause}`);
}

async function responseJson(response: Response) {
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) throw new Error('第三方授权服务暂时不可用，请稍后重试');
  return payload;
}

export function normalizeEmail(value: string) { return value.trim().toLowerCase(); }

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  const [algorithm, salt, expected] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !expected) return false;
  const derived = await scrypt(password, salt, 64) as Buffer;
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return expectedBuffer.length === derived.length && timingSafeEqual(expectedBuffer, derived);
}

export function sessionToken() { return randomBytes(32).toString('base64url'); }
export function oauthState() { return randomBytes(24).toString('base64url'); }
export function sessionExpiry() { return Date.now() + SESSION_MAX_AGE_SECONDS * 1000; }

export function cookieValue(header: string | undefined, name: string) {
  if (!header) return null;
  const prefix = `${name}=`;
  for (const entry of header.split(';')) {
    const trimmed = entry.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

export function cookie(name: string, value: string, maxAgeSeconds = SESSION_MAX_AGE_SECONDS) {
  const attributes = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
  if (process.env.NODE_ENV === 'production') attributes.push('Secure');
  return attributes.join('; ');
}

export function clearCookie(name: string) { return cookie(name, '', 0); }
export function sessionCookieName() { return 'echoline_session'; }
export function oauthCookieName(provider: OAuthProvider) { return `echoline_oauth_${provider}`; }
export function appHomePath() { return `${appBasePath()}/`; }

export function startOAuth(db: EchoDatabase, provider: OAuthProvider, request: FastifyRequest) {
  const credentials = config(provider);
  if (!credentials) throw new Error(`${provider === 'github' ? 'GitHub' : 'Google'} 授权尚未配置`);
  const state = oauthState();
  const redirectUri = callbackUrl(provider, request);
  db.createOAuthState(state, provider, Date.now() + 10 * 60 * 1000);
  const url = provider === 'github'
    ? new URL('https://github.com/login/oauth/authorize')
    : new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', credentials.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  if (provider === 'github') url.searchParams.set('scope', 'read:user user:email');
  else { url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', 'openid email profile'); url.searchParams.set('access_type', 'online'); url.searchParams.set('prompt', 'select_account'); }
  return { state, url: url.toString() };
}

export async function exchangeOAuthProfile(provider: OAuthProvider, code: string, request: FastifyRequest): Promise<OAuthProfile> {
  const credentials = config(provider);
  if (!credentials) throw new Error(`${provider === 'github' ? 'GitHub' : 'Google'} 授权尚未配置`);
  const redirectUri = callbackUrl(provider, request);
  if (provider === 'github') {
    const tokenPayload = await responseJson(await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, code, redirect_uri: redirectUri }),
    })) as { access_token?: unknown };
    const accessToken = text(tokenPayload.access_token); if (!accessToken) throw new Error('GitHub 没有返回授权令牌');
    const userPayload = await responseJson(await fetch('https://api.github.com/user', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'User-Agent': 'EchoLine' } })) as Record<string, unknown>;
    let email = text(userPayload.email);
    if (!email) {
      const emails = await responseJson(await fetch('https://api.github.com/user/emails', { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'User-Agent': 'EchoLine' } })) as Array<Record<string, unknown>>;
      const preferred = emails.find((item) => item.primary === true && item.verified === true) || emails.find((item) => item.verified === true);
      email = text(preferred?.email);
    }
    const subject = String(userPayload.id || '');
    if (!subject || !email) throw new Error('GitHub 账号没有可用的已验证邮箱');
    return { subject, email: normalizeEmail(email), displayName: text(userPayload.name) || text(userPayload.login) || 'GitHub 用户', avatarUrl: text(userPayload.avatar_url) || null };
  }
  const tokenPayload = await responseJson(await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }),
  })) as { access_token?: unknown };
  const accessToken = text(tokenPayload.access_token); if (!accessToken) throw new Error('Google 没有返回授权令牌');
  const profile = await responseJson(await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })) as Record<string, unknown>;
  const subject = text(profile.sub); const email = normalizeEmail(text(profile.email));
  if (!subject || !email || profile.email_verified !== true) throw new Error('Google 账号没有可用的已验证邮箱');
  return { subject, email, displayName: text(profile.name) || email.split('@')[0], avatarUrl: text(profile.picture) || null };
}

export function authenticateOAuthUser(db: EchoDatabase, provider: OAuthProvider, profile: OAuthProfile) {
  const linked = db.getUserByIdentity(provider, profile.subject);
  if (linked) return linked;
  const existing = db.getUserByEmail(profile.email);
  const user = existing ? db.getUser(existing.id)! : db.createUser(profile.email, null, profile.displayName, profile.avatarUrl);
  db.addOAuthIdentity(provider, profile.subject, user.id);
  return user;
}
