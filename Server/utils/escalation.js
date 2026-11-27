import Session from '../models/Session.js';

const DEFAULT_ESCALATION_TIMEOUT_HOURS = 12;

/**
 * Mengembalikan durasi auto-reset eskalasi dalam milidetik.
 * Nilai `0` atau negatif menonaktifkan auto-reset.
 */
export function getEscalationTimeoutMs() {
  const raw = process.env.ESCALATION_TIMEOUT_HOURS;
  if (raw === undefined || raw === '') {
    return DEFAULT_ESCALATION_TIMEOUT_HOURS * 60 * 60 * 1000;
  }

  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    return 0;
  }

  return hours * 60 * 60 * 1000;
}

/**
 * Mengecek apakah sesi `escalated` sudah melewati batas waktu auto-reset.
 */
export function isEscalationExpired(session, now = new Date()) {
  if (!session || session.status !== 'escalated' || !session.escalatedAt) {
    return false;
  }

  const timeoutMs = getEscalationTimeoutMs();
  if (timeoutMs <= 0) {
    return false;
  }

  const escalatedTime = new Date(session.escalatedAt).getTime();
  if (!Number.isFinite(escalatedTime)) {
    return false;
  }

  return now.getTime() - escalatedTime >= timeoutMs;
}

/**
 * Mengaktifkan kembali seluruh sesi `escalated` yang sudah melewati batas waktu.
 */
export async function releaseExpiredEscalations(now = new Date()) {
  const timeoutMs = getEscalationTimeoutMs();
  if (timeoutMs <= 0) return;

  const cutoff = new Date(now.getTime() - timeoutMs);
  await Session.updateMany(
    {
      status: 'escalated',
      escalatedAt: { $ne: null, $lte: cutoff },
    },
    {
      $set: {
        status: 'active',
        escalatedAt: null,
        contextResetAt: now,
      },
    }
  );
}
