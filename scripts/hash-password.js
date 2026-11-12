#!/usr/bin/env node
'use strict';
/* Usage: npm run admin:hash -- "your-strong-password"   -> prints ADMIN_PASSWORD_HASH=... for your .env */
const crypto = require('crypto');
const pw = process.argv[2];
if (!pw || pw.length < 12) { console.error('Usage: npm run admin:hash -- "<password of at least 12 characters>"'); process.exit(1); }
const salt = crypto.randomBytes(16);
console.log('ADMIN_PASSWORD_HASH=scrypt$' + salt.toString('hex') + '$' + crypto.scryptSync(pw, salt, 64).toString('hex'));
