/**
 * בדיקת רגרסיה למקודד ה-QR — הרצה: node tools/qr-test.mjs
 *
 * טביעות האצבע נלכדו לאחר אימות מול מקודד הייחוס segno (התאמה מלאה
 * בקיבולת עבור כל 160 צירופי גרסה/רמת תיקון) ולאחר פענוח מוצלח של
 * הקודים בפועל ע"י zbar ו-OpenCV, כולל טקסט עברי ב-UTF-8.
 */

import { createHash } from 'node:crypto';
import { encodeQr, qrToSvg } from '../js/qr.js';

const FINGERPRINTS = [
  ['HELLO WORLD', 'M', 1, 3, 'da030348c4f3821c'],
  ['MBX1|BOX-001|חדר נעם|ספרים, מנורה', 'M', 4, 0, '30c0766450e4b613'],
  ['MBX1|BOX-137|ארונות בגדים חדר שינה|מעילים, סוודרים, צעיפים', 'Q', 8, 2, '8732076bec73c4f8'],
  ['https://example.com/moving-box-manager/#/box/BOX-042', 'H', 6, 5, '58c7740f8ba53763'],
  ['x'.repeat(1200), 'L', 25, 0, '8ba95092f7d6b575'],
  ['א'.repeat(400), 'H', 32, 4, '2f909d2fe9003c68'],
];

// קיבולת מרבית במצב Byte לגרסאות נבחרות (ערכי התקן)
const CAPACITIES = [
  [1, 'L', 17], [1, 'H', 7], [10, 'M', 213], [20, 'Q', 482],
  [32, 'H', 842], [40, 'L', 2953], [40, 'H', 1273],
];

let failures = 0;
const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name} ${detail}`);
  }
};

console.log('טביעות אצבע של מטריצות:');
for (const [text, ecc, version, mask, hash] of FINGERPRINTS) {
  const qr = encodeQr(text, { ecc });
  const actual = createHash('sha256')
    .update(qr.modules.map((row) => row.map((m) => (m ? 1 : 0)).join('')).join(''))
    .digest('hex')
    .slice(0, 16);
  const label = `${text.length > 28 ? text.slice(0, 25) + '…' : text} [${ecc}]`;
  check(
    label,
    qr.version === version && qr.mask === mask && actual === hash,
    `expected v${version}/mask${mask}/${hash}, got v${qr.version}/mask${qr.mask}/${actual}`
  );
}

console.log('\nקיבולת לפי גרסה ורמת תיקון:');
for (const [version, ecc, capacity] of CAPACITIES) {
  const fits = (() => {
    try {
      return encodeQr('a'.repeat(capacity), { ecc, minVersion: version, maxVersion: version }).version === version;
    } catch {
      return false;
    }
  })();
  const overflows = (() => {
    try {
      encodeQr('a'.repeat(capacity + 1), { ecc, minVersion: version, maxVersion: version });
      return false;
    } catch {
      return true;
    }
  })();
  check(`v${version}${ecc} = ${capacity} בתים`, fits && overflows, `fits=${fits} overflows=${overflows}`);
}

console.log('\nפלט SVG:');
const svg = qrToSvg('MBX1|BOX-001|מטבח|צלחות', { ecc: 'M', margin: 2 });
check('נוצר SVG תקין', svg.startsWith('<svg') && svg.includes('viewBox="0 0 33 33"') && svg.endsWith('</svg>'));
check('נתונים גדולים מהקיבולת נדחים', (() => {
  try { encodeQr('a'.repeat(3000), { ecc: 'L' }); return false; } catch { return true; }
})());

console.log(failures === 0 ? '\nכל הבדיקות עברו ✓' : `\n${failures} בדיקות נכשלו ✗`);
process.exit(failures === 0 ? 0 : 1);
