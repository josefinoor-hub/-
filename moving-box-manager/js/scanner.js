/**
 * scanner.js — סריקת QR ממצלמת המכשיר.
 *
 * הפענוח נעשה ב-BarcodeDetector, ממשק מובנה בכרום לאנדרואיד. הוא מהיר,
 * לא דורש ספרייה חיצונית ולכן עובד גם ללא רשת. בדפדפן שאינו תומך מוצגת
 * הקלדה ידנית של מספר הארגז במקום המצלמה.
 */

const DETECT_INTERVAL_MS = 150;

export function isSupported() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export function cameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * הפעלת המצלמה והתחלת סריקה רציפה.
 * @param {HTMLVideoElement} video
 * @param {(text: string) => void} onDetect נקרא פעם אחת לכל קוד שזוהה
 * @returns {Promise<{stop: () => void, toggleTorch: () => Promise<boolean>}>}
 */
export async function start(video, onDetect) {
  if (!cameraAvailable()) throw new Error('אין גישה למצלמה בדפדפן הזה');
  if (!isSupported()) {
    throw new Error('הדפדפן אינו תומך בסריקת קודים. אפשר להקליד את מספר הארגז ידנית.');
  }

  const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });

  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  await video.play();

  let stopped = false;
  let lastDetection = 0;

  const tick = async () => {
    if (stopped) return;
    const now = performance.now();
    if (now - lastDetection >= DETECT_INTERVAL_MS && video.readyState >= 2) {
      lastDetection = now;
      try {
        const codes = await detector.detect(video);
        if (codes.length && !stopped) {
          const value = codes[0].rawValue;
          if (value) onDetect(value);
        }
      } catch (error) {
        // כשל זיהוי בפריים בודד הוא שגרתי — ממשיכים לפריים הבא
        console.debug('פענוח פריים נכשל', error);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const [track] = stream.getVideoTracks();
  let torchOn = false;

  return {
    stop() {
      stopped = true;
      for (const streamTrack of stream.getTracks()) streamTrack.stop();
      video.srcObject = null;
    },
    /** הדלקת פנס — שימושי במחסן או בחדר חשוך. */
    async toggleTorch() {
      const capabilities = track?.getCapabilities?.();
      if (!capabilities?.torch) return false;
      torchOn = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: torchOn }] });
      return torchOn;
    },
  };
}
