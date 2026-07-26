const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { generateApiKey } = require('../middleware/auth');

const router = express.Router();

const VALID_SCOPES = ['racks:read', 'racks:write', 'optimize:run', 'placements:read', '*'];

/**
 * @openapi
 * /api/auth/keys:
 *   post:
 *     summary: Issue a new scoped API key
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [owner, scopes]
 *             properties:
 *               owner:
 *                 type: string
 *                 example: "daivik-demo"
 *               scopes:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["racks:read", "racks:write", "optimize:run", "placements:read"]
 *               expires_in_days:
 *                 type: integer
 *                 example: 30
 *     responses:
 *       201:
 *         description: >
 *           API key created. The raw key is returned ONCE — store it now,
 *           it cannot be retrieved again (only the hash is persisted).
 */
router.post('/', (req, res) => {
  const { owner, scopes, expires_in_days } = req.body || {};

  if (!owner || typeof owner !== 'string') {
    return res.status(400).json({ error: 'owner (string) is required' });
  }
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return res.status(400).json({ error: 'scopes (non-empty array) is required' });
  }
  const invalid = scopes.filter((s) => !VALID_SCOPES.includes(s));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Invalid scopes: ${invalid.join(', ')}`, validScopes: VALID_SCOPES });
  }

  const { raw, prefix, hash } = generateApiKey();
  const id = uuidv4();
  const expiresAt = expires_in_days
    ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000).toISOString()
    : null;

  db.prepare(
    `INSERT INTO api_keys (id, key_prefix, key_hash, owner, scopes, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, prefix, hash, owner, scopes.join(','), expiresAt);

  res.status(201).json({
    id,
    api_key: raw, // shown once
    key_prefix: prefix,
    owner,
    scopes,
    expires_at: expiresAt,
    warning: 'Store this key now — it will not be shown again.',
  });
});

module.exports = router;
