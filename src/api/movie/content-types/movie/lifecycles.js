module.exports = {
  beforeCreate(event) {
    const { data } = event.params;
    if (data.rating !== null && data.rating !== undefined) {
      data.rating = Math.round(data.rating * 10) / 10;
    }
    syncTranslationFlags(data);
  },

  beforeUpdate(event) {
    const { data } = event.params;
    if (data.rating !== null && data.rating !== undefined) {
      data.rating = Math.round(data.rating * 10) / 10;
    }
    syncTranslationFlags(data);
  },
};

// Keep `isLuganda` and `translatedLanguage` consistent so legacy filtering
// code (which keys off isLuganda) keeps working alongside the new generic
// translatedLanguage enum used for Runyankole, Rutooro, etc.
function syncTranslationFlags(data) {
  if (!data) return;
  if (Object.prototype.hasOwnProperty.call(data, 'translatedLanguage')) {
    if (data.translatedLanguage === 'Luganda') {
      data.isLuganda = true;
    } else if (data.translatedLanguage) {
      // Any other translated language: ensure isLuganda is not stuck on true
      // unless caller explicitly set it.
      if (!Object.prototype.hasOwnProperty.call(data, 'isLuganda')) {
        data.isLuganda = false;
      }
    }
  } else if (data.isLuganda === true) {
    // Legacy entries: backfill translatedLanguage when only isLuganda is set
    data.translatedLanguage = 'Luganda';
  }
}
