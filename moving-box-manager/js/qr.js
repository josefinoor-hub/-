/**
 * qr.js — מקודד QR עצמאי (ללא ספריות חיצוניות), מצב Byte / UTF-8.
 * תומך בגרסאות 1–40 ובכל רמות תיקון השגיאות, ומחזיר מטריצת מודולים
 * שממנה נבנה SVG וקטורי (למסך ולהדפסה) או ביטמאפ (למדפסת תרמית).
 *
 * המימוש עוקב אחר תקן ISO/IEC 18004.
 */

// ---------------------------------------------------------------------------
// טבלאות התקן
// ---------------------------------------------------------------------------

// מספר קודוורדים של תיקון שגיאות לכל בלוק, לפי [רמה][גרסה]
const ECC_CODEWORDS_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};

// מספר בלוקי תיקון שגיאות, לפי [רמה][גרסה]
const NUM_ECC_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};

// ביטים של מידע הפורמט לכל רמת תיקון (2 ביט)
const ECC_FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// ---------------------------------------------------------------------------
// אריתמטיקה בשדה גלואה GF(256) עם הפולינום 0x11D
// ---------------------------------------------------------------------------

function gfMultiply(a, b) {
  let result = 0;
  for (let i = 7; i >= 0; i--) {
    result = (result << 1) ^ ((result >>> 7) * 0x11d);
    result ^= ((b >>> i) & 1) * a;
  }
  return result & 0xff;
}

/** פולינום יוצר עבור degree קודוורדים של תיקון שגיאות. */
function reedSolomonGenerator(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

/** חישוב קודוורדים של תיקון שגיאות עבור בלוק נתונים. */
function reedSolomonRemainder(data, generator) {
  const result = new Uint8Array(generator.length);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let i = 0; i < generator.length; i++) {
      result[i] ^= gfMultiply(generator[i], factor);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// חישובי קיבולת
// ---------------------------------------------------------------------------

/** מיקומי מרכזי תבניות היישור (alignment) עבור גרסה נתונה. */
function alignmentPatternPositions(version) {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const positions = [];
  for (let pos = version * 4 + 10; positions.length < count - 1; pos -= step) {
    positions.unshift(pos);
  }
  positions.unshift(6); // המיקום הראשון קבוע וצמוד לתבנית האיתור
  return positions;
}

/** מספר מודולי הנתונים הגולמיים (לפני חלוקה לקודוורדים). */
function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** מספר קודוורדי הנתונים (ללא תיקון שגיאות) לגרסה ורמה. */
function dataCodewordCount(version, ecc) {
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecc][version] * NUM_ECC_BLOCKS[ecc][version]
  );
}

// ---------------------------------------------------------------------------
// קידוד הנתונים
// ---------------------------------------------------------------------------

class BitBuffer {
  constructor() {
    this.bits = [];
  }
  append(value, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >>> i) & 1);
    }
  }
  get length() {
    return this.bits.length;
  }
}

/** אורך שדה סופר התווים במצב Byte, תלוי גרסה. */
function charCountBits(version) {
  return version <= 9 ? 8 : 16;
}

/** בוחר את הגרסה הקטנה ביותר שמכילה את הנתונים. */
function chooseVersion(byteLength, ecc, minVersion, maxVersion) {
  for (let version = minVersion; version <= maxVersion; version++) {
    const capacityBits = dataCodewordCount(version, ecc) * 8;
    const usedBits = 4 + charCountBits(version) + byteLength * 8;
    if (usedBits <= capacityBits) return version;
  }
  throw new Error(`הנתונים ארוכים מדי עבור קוד QR (${byteLength} בתים)`);
}

/** בונה את מערך קודוורדי הנתונים כולל ריפוד. */
function buildDataCodewords(bytes, version, ecc) {
  const buffer = new BitBuffer();
  buffer.append(0b0100, 4); // מצב Byte
  buffer.append(bytes.length, charCountBits(version));
  for (const byte of bytes) buffer.append(byte, 8);

  const capacityBits = dataCodewordCount(version, ecc) * 8;
  buffer.append(0, Math.min(4, capacityBits - buffer.length)); // terminator
  buffer.append(0, (8 - (buffer.length % 8)) % 8); // יישור לבייט

  const codewords = new Uint8Array(capacityBits / 8);
  for (let i = 0; i < buffer.length; i++) {
    codewords[i >>> 3] |= buffer.bits[i] << (7 - (i & 7));
  }
  for (let i = buffer.length / 8, pad = 0xec; i < codewords.length; i++, pad ^= 0xec ^ 0x11) {
    codewords[i] = pad;
  }
  return codewords;
}

/** מוסיף תיקון שגיאות ומשרשר את הבלוקים לפי סדר ה-interleaving של התקן. */
function addEccAndInterleave(dataCodewords, version, ecc) {
  const numBlocks = NUM_ECC_BLOCKS[ecc][version];
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ecc][version];
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockDataLen = Math.floor(rawCodewords / numBlocks) - eccPerBlock;

  const generator = reedSolomonGenerator(eccPerBlock);
  const blocks = [];
  for (let i = 0, offset = 0; i < numBlocks; i++) {
    const dataLen = shortBlockDataLen + (i < numShortBlocks ? 0 : 1);
    const data = dataCodewords.slice(offset, offset + dataLen);
    offset += dataLen;
    blocks.push({ data, ecc: reedSolomonRemainder(data, generator) });
  }

  const result = [];
  for (let i = 0; i < shortBlockDataLen + 1; i++) {
    blocks.forEach((block, index) => {
      // הבלוק הקצר מדלג על המיקום האחרון
      if (i !== shortBlockDataLen || index >= numShortBlocks) result.push(block.data[i]);
    });
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (const block of blocks) result.push(block.ecc[i]);
  }
  return Uint8Array.from(result);
}

// ---------------------------------------------------------------------------
// בניית המטריצה
// ---------------------------------------------------------------------------

class Matrix {
  constructor(size) {
    this.size = size;
    this.modules = Array.from({ length: size }, () => new Array(size).fill(false));
    this.reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  }
  set(x, y, dark, reserve = true) {
    this.modules[y][x] = dark;
    if (reserve) this.reserved[y][x] = true;
  }
  get(x, y) {
    return this.modules[y][x];
  }
  inside(x, y) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }
}

function drawFinderPattern(matrix, centerX, centerY) {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = centerX + dx;
      const y = centerY + dy;
      if (!matrix.inside(x, y)) continue;
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      matrix.set(x, y, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignmentPattern(matrix, centerX, centerY) {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      matrix.set(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawFunctionPatterns(matrix, version, ecc) {
  const size = matrix.size;

  // תבניות תזמון
  for (let i = 0; i < size; i++) {
    matrix.set(6, i, i % 2 === 0);
    matrix.set(i, 6, i % 2 === 0);
  }

  // שלוש תבניות איתור + מרווח מפריד
  drawFinderPattern(matrix, 3, 3);
  drawFinderPattern(matrix, size - 4, 3);
  drawFinderPattern(matrix, 3, size - 4);

  // תבניות יישור
  const positions = alignmentPatternPositions(version);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const isFinderCorner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (!isFinderCorner) drawAlignmentPattern(matrix, positions[i], positions[j]);
    }
  }

  // שריון מקומות מידע הפורמט (הערך האמיתי נכתב אחרי בחירת המסכה)
  drawFormatBits(matrix, ecc, 0);

  // מידע הגרסה (מגרסה 7 ומעלה)
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) {
      remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    }
    const bits = ((version << 12) | remainder) >>> 0;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      matrix.set(a, b, bit);
      matrix.set(b, a, bit);
    }
  }
}

function drawFormatBits(matrix, ecc, mask) {
  const size = matrix.size;
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  const bits = (((data << 10) | remainder) ^ 0x5412) >>> 0;

  // עותק ראשון — סביב תבנית האיתור השמאלית-עליונה
  for (let i = 0; i <= 5; i++) matrix.set(8, i, ((bits >>> i) & 1) === 1);
  matrix.set(8, 7, ((bits >>> 6) & 1) === 1);
  matrix.set(8, 8, ((bits >>> 7) & 1) === 1);
  matrix.set(7, 8, ((bits >>> 8) & 1) === 1);
  for (let i = 9; i < 15; i++) matrix.set(14 - i, 8, ((bits >>> i) & 1) === 1);

  // עותק שני — לאורך הקצוות
  for (let i = 0; i < 8; i++) matrix.set(size - 1 - i, 8, ((bits >>> i) & 1) === 1);
  for (let i = 8; i < 15; i++) matrix.set(8, size - 15 + i, ((bits >>> i) & 1) === 1);
  matrix.set(8, size - 8, true); // מודול כהה קבוע
}

/** פורש את קודוורדי הנתונים בזיגזג מימין לשמאל, מלמטה למעלה. */
function drawCodewords(matrix, codewords) {
  const size = matrix.size;
  let bitIndex = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // מדלגים על עמודת התזמון האנכית
    for (let vertical = 0; vertical < size; vertical++) {
      for (let column = 0; column < 2; column++) {
        const x = right - column;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (matrix.reserved[y][x]) continue;
        const bit =
          bitIndex < codewords.length * 8
            ? ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1
            : false;
        matrix.set(x, y, bit, false);
        bitIndex++;
      }
    }
  }
}

const MASK_FUNCTIONS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(matrix, mask) {
  const fn = MASK_FUNCTIONS[mask];
  for (let y = 0; y < matrix.size; y++) {
    for (let x = 0; x < matrix.size; x++) {
      if (!matrix.reserved[y][x] && fn(x, y)) {
        matrix.modules[y][x] = !matrix.modules[y][x];
      }
    }
  }
}

/** ציון קנס לפי התקן — ככל שנמוך יותר, המסכה טובה יותר. */
function penaltyScore(matrix) {
  const size = matrix.size;
  let score = 0;

  const runPenalty = (runLength) => (runLength >= 5 ? 3 + (runLength - 5) : 0);

  // כלל 1 — רצפים של אותו צבע
  for (let y = 0; y < size; y++) {
    let runColor = matrix.get(0, y);
    let runLength = 1;
    for (let x = 1; x < size; x++) {
      if (matrix.get(x, y) === runColor) {
        runLength++;
      } else {
        score += runPenalty(runLength);
        runColor = matrix.get(x, y);
        runLength = 1;
      }
    }
    score += runPenalty(runLength);
  }
  for (let x = 0; x < size; x++) {
    let runColor = matrix.get(x, 0);
    let runLength = 1;
    for (let y = 1; y < size; y++) {
      if (matrix.get(x, y) === runColor) {
        runLength++;
      } else {
        score += runPenalty(runLength);
        runColor = matrix.get(x, y);
        runLength = 1;
      }
    }
    score += runPenalty(runLength);
  }

  // כלל 2 — ריבועים 2x2 באותו צבע
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = matrix.get(x, y);
      if (
        color === matrix.get(x + 1, y) &&
        color === matrix.get(x, y + 1) &&
        color === matrix.get(x + 1, y + 1)
      ) {
        score += 3;
      }
    }
  }

  // כלל 3 — תבנית הדומה לתבנית איתור (1:1:3:1:1 עם אזור שקט)
  const finderPattern = [true, false, true, true, true, false, true];
  const matchesAt = (get, index, limit) => {
    if (index + 7 > limit) return false;
    for (let i = 0; i < 7; i++) {
      if (get(index + i) !== finderPattern[i]) return false;
    }
    const quietBefore = [1, 2, 3, 4].every((i) => index - i < 0 || get(index - i) === false);
    const quietAfter = [0, 1, 2, 3].every((i) => index + 7 + i >= limit || get(index + 7 + i) === false);
    return quietBefore || quietAfter;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (matchesAt((i) => matrix.get(i, y), x, size)) score += 40;
      if (matchesAt((i) => matrix.get(x, i), y, size)) score += 40;
    }
  }

  // כלל 4 — סטייה מאיזון שחור/לבן
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (matrix.get(x, y)) dark++;
  }
  const total = size * size;
  const deviation = Math.floor((Math.abs(dark * 20 - total * 10) * 10) / total);
  score += deviation * 10;

  return score;
}

// ---------------------------------------------------------------------------
// ממשק ציבורי
// ---------------------------------------------------------------------------

/**
 * מקודד מחרוזת לקוד QR.
 * @param {string} text הטקסט לקידוד (מקודד כ-UTF-8).
 * @param {{ecc?: 'L'|'M'|'Q'|'H', minVersion?: number, maxVersion?: number}} [options]
 * @returns {{size: number, version: number, ecc: string, mask: number, modules: boolean[][]}}
 */
export function encodeQr(text, options = {}) {
  const ecc = options.ecc || 'M';
  const minVersion = options.minVersion || 1;
  const maxVersion = options.maxVersion || 40;

  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length, ecc, minVersion, maxVersion);
  const dataCodewords = buildDataCodewords(bytes, version, ecc);
  const allCodewords = addEccAndInterleave(dataCodewords, version, ecc);

  const size = version * 4 + 17;
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = new Matrix(size);
    drawFunctionPatterns(matrix, version, ecc);
    drawCodewords(matrix, allCodewords);
    applyMask(matrix, mask);
    drawFormatBits(matrix, ecc, mask);
    const score = penaltyScore(matrix);
    if (!best || score < best.score) best = { score, mask, matrix };
  }

  return {
    size,
    version,
    ecc,
    mask: best.mask,
    modules: best.matrix.modules,
  };
}

/**
 * ממיר קוד QR ל-SVG וקטורי (חד ובכל רזולוציה — למסך ולהדפסה).
 * @param {string} text
 * @param {{ecc?: string, margin?: number, size?: number|string, className?: string}} [options]
 * @returns {string} מחרוזת SVG
 */
export function qrToSvg(text, options = {}) {
  const { modules, size } = encodeQr(text, options);
  const margin = options.margin ?? 2;
  const dimension = size + margin * 2;

  // איחוד מודולים סמוכים באותה שורה למלבן אחד — SVG קטן ומהיר יותר
  const paths = [];
  for (let y = 0; y < size; y++) {
    let runStart = -1;
    for (let x = 0; x <= size; x++) {
      const dark = x < size && modules[y][x];
      if (dark && runStart < 0) runStart = x;
      if (!dark && runStart >= 0) {
        paths.push(`M${runStart + margin} ${y + margin}h${x - runStart}v1h-${x - runStart}z`);
        runStart = -1;
      }
    }
  }

  const sizeAttr = options.size ? ` width="${options.size}" height="${options.size}"` : '';
  const classAttr = options.className ? ` class="${options.className}"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dimension} ${dimension}"` +
    `${sizeAttr}${classAttr} shape-rendering="crispEdges" role="img">` +
    `<rect width="${dimension}" height="${dimension}" fill="#ffffff"/>` +
    `<path d="${paths.join('')}" fill="#000000"/>` +
    `</svg>`
  );
}

/** SVG כ-data URI — שימושי כמקור לתגית img ולהטמעה בהדפסה. */
export function qrToDataUri(text, options = {}) {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qrToSvg(text, options));
}
