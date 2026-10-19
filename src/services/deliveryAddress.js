const DISTRICT = "Malda";
const PIN_CODE = "732210";

function addressError(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeDeliveryAddress(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw addressError("Enter your delivery address");
  }

  const fullName = cleanText(input.fullName, 80);
  const locality = cleanText(input.locality, 120);
  const village = cleanText(input.village, 100);
  const postOffice = cleanText(input.postOffice, 100);
  const rawPhone = cleanText(input.phone, 20).replace(/[^\d]/g, "");
  const phone = rawPhone.length === 12 && rawPhone.startsWith("91") ? rawPhone.slice(2) : rawPhone;
  const hasLatitude = input.latitude !== undefined && input.latitude !== null && input.latitude !== "";
  const hasLongitude = input.longitude !== undefined && input.longitude !== null && input.longitude !== "";

  if (fullName.length < 2) throw addressError("Enter your full name");
  if (!/^[6-9]\d{9}$/.test(phone)) throw addressError("Enter a valid 10-digit Indian mobile number");
  if (locality.length < 2) throw addressError("Enter your para or locality");
  if (village.length < 2) throw addressError("Choose a village or enter it manually");
  if (postOffice.length < 2) throw addressError("Choose a Post Office or enter it manually");
  if (hasLatitude !== hasLongitude) throw addressError("Latitude and longitude must be provided together");
  if (hasLatitude && (
    typeof input.latitude !== "number" ||
    typeof input.longitude !== "number" ||
    !Number.isFinite(input.latitude) ||
    !Number.isFinite(input.longitude) ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    input.longitude < -180 ||
    input.longitude > 180
  )) throw addressError("Enter valid latitude and longitude values");

  return {
    fullName,
    phone,
    locality,
    village,
    villageCustom: Boolean(input.villageCustom),
    postOffice,
    postOfficeCustom: Boolean(input.postOfficeCustom),
    district: DISTRICT,
    pinCode: PIN_CODE,
    ...(hasLatitude ? { latitude: input.latitude, longitude: input.longitude } : {})
  };
}

function formatDeliveryAddress(address) {
  return [
    address.fullName,
    address.locality,
    address.village,
    address.postOffice,
    address.district,
    address.pinCode
  ].join(", ");
}

module.exports = { normalizeDeliveryAddress, formatDeliveryAddress, DISTRICT, PIN_CODE };
