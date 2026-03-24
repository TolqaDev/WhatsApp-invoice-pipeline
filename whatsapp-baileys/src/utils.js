/**
 * Fatura Bot — Node bridge ortak yardımcı fonksiyonlar.
 */

/**
 * JID veya phone number string'inden saf numarayı çıkarır.
 * Örnek: "905551234567@s.whatsapp.net" → "905551234567"
 */
export function extractNumber(jidOrPn) {
  if (!jidOrPn) return '';
  return jidOrPn.split('@')[0].split(':')[0];
}

