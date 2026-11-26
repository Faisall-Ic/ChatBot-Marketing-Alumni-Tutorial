let waModule = null;

/**
 * Menghubungkan server dengan Server/services/whatsappService.js jika sudah tersedia.
 * Memungkinkan REST API & AI tetap berjalan mandiri sebelum branch WhatsApp digabung.
 */
export async function initWhatsAppBridge(onIncomingMessage) {
  try {
    waModule = await import('./whatsappService.js');
    if (typeof waModule.startWhatsApp === 'function') {
      await waModule.startWhatsApp(onIncomingMessage);
    }
    return true;
  } catch (error) {
    const isMissingSelf =
      error?.code === 'ERR_MODULE_NOT_FOUND' &&
      error?.message?.includes('whatsappService.js');

    if (isMissingSelf) {
      console.warn(
        'Info: Server/services/whatsappService.js belum tersedia. Mode REST API standalone aktif.'
      );
      waModule = null;
      return false;
    }

    console.error('Gagal menginisialisasi WhatsApp Gateway:', error);
    return false;
  }
}

export function getSafeWaStatus() {
  if (waModule && typeof waModule.getWaStatus === 'function') {
    return waModule.getWaStatus();
  }

  return {
    status: 'disconnected',
    qr: null,
    botNumber: null,
  };
}

export async function sendSafeWhatsAppMessage(phone, text) {
  if (!waModule || typeof waModule.sendWhatsAppMessage !== 'function') {
    const error = new Error(
      'WhatsApp Gateway belum tersedia atau belum terhubung'
    );
    error.statusCode = 503;
    throw error;
  }

  try {
    return await waModule.sendWhatsAppMessage(phone, text);
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 503;
    }
    throw error;
  }
}
