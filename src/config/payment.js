function getPaymentConfig() {
  const configuredId = String(process.env.UPI_ID || "").trim();
  const configuredQr = String(process.env.UPI_QR_CODE_URL || "").trim();
  const upiId = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9.-]{2,64}$/.test(configuredId) ? configuredId : "";
  // Public HTTPS image or same-origin path; never expose other environment values.
  const qrCodeUrl = /^(https:\/\/[^\s]+|\/(?!\/)[^\s]*)$/.test(configuredQr) ? configuredQr : "";
  return { upiId, qrCodeUrl, enabled: Boolean(upiId) };
}

module.exports = { getPaymentConfig };