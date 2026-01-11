const crypto = require("crypto");

/**
 * Generate QR code data for guardian access
 * @param {string} guardianId - Guardian ID
 * @param {string} qrCode - QR code string
 * @returns {string} JSON string containing access data
 */
const generateGuardianQRData = (guardianId, qrCode) => {
  return JSON.stringify({
    type: "guardian_access",
    guardianId,
    qrCode,
    timestamp: Date.now(),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  });
};

/**
 * Verify QR code data
 * @param {string} qrData - QR code data string
 * @param {string} guardianId - Expected guardian ID
 * @param {string} qrCode - Expected QR code
 * @returns {boolean} Whether the QR code is valid
 */
const verifyGuardianQRData = (qrData, guardianId, qrCode) => {
  try {
    const data = JSON.parse(qrData);

    // Check type
    if (data.type !== "guardian_access") {
      return false;
    }

    // Check guardian ID
    if (data.guardianId !== guardianId) {
      return false;
    }

    // Check QR code
    if (data.qrCode !== qrCode) {
      return false;
    }

    // Check expiration
    if (Date.now() > data.expiresAt) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
};

/**
 * Generate a unique QR code string
 * @returns {string} Unique QR code
 */
const generateUniqueQRCode = () => {
  return crypto.randomBytes(16).toString("hex").toUpperCase();
};

module.exports = {
  generateGuardianQRData,
  verifyGuardianQRData,
  generateUniqueQRCode,
};
