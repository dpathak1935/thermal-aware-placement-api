const crypto = require('crypto');
const db = require('../db');

function hashKey(rawKey) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

function generateApiKey() {
  const raw = 'tp_' + crypto.randomBytes(24).toString('hex'); // "tp_" = thermal-placement prefix
  return { raw, prefix: raw.slice(0, 11), hash: hashKey(raw) };
}

/**
 * Express middleware factory. Pass required scope(s) to enforce per-route,
 * e.g. requireApiKey('racks:write').
 */
function requireApiKey(requiredScope) {
  return (req, res, next) => {
    const header = req.header('x-api-key') || (req.header('authorization') || '').replace(/^Bearer /i, '');
    if (!header) {
      return res.status(401).json({ error: 'Missing API key. Send it in the x-api-key header.' });
    }

    const hash = hashKey(header);
    const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hash);

    if (!row) return res.status(401).json({ error: 'Invalid API key.' });
    if (row.revoked_at) return res.status(401).json({ error: 'API key has been revoked.' });
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      return res.status(401).json({ error: 'API key has expired.' });
    }

    const scopes = row.scopes.split(',').map((s) => s.trim());
    if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('*')) {
      return res.status(403).json({ error: `API key lacks required scope: ${requiredScope}` });
    }

    db.prepare('UPDATE api_keys SET last_used_at = datetime(\'now\') WHERE id = ?').run(row.id);

    req.apiKey = { id: row.id, owner: row.owner, scopes };
    next();
  };
}

module.exports = { requireApiKey, generateApiKey, hashKey };
