/**
 * Run: node scripts/test-scorm-registration-refresh.js
 */
import assert from 'node:assert/strict';
import {
    isPackageNewerThanRegistration,
} from '../src/lib/scormRegistrationRefresh.js';

const oldAttempt = { createdAt: new Date('2026-01-01T00:00:00Z') };
const pkgV1 = { uploadedAt: new Date('2026-01-01T00:00:00Z') };
const pkgV2 = { uploadedAt: new Date('2026-07-29T00:00:00Z') };

assert.equal(isPackageNewerThanRegistration(pkgV1, oldAttempt), false);
assert.equal(isPackageNewerThanRegistration(pkgV2, oldAttempt), true);

console.log('SCORM registration refresh tests passed.');
