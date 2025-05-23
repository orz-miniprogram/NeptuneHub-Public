// backend/utils/isOutsidePeakPeriod.js

/**
 * Determines if a given time string falls outside predefined peak periods.
 * Peak periods are defined as 7 AM - 9 AM and 5 PM - 7 PM (17:00 - 19:00).
 *
 * @param {string} timeString - The time in "HH:MM" format (e.g., "08:30", "17:45").
 * @returns {boolean} - True if the time is outside peak period, false otherwise or if input is invalid.
 */
const isOutsidePeakPeriod = (timeString) => {
  // Basic validation for time format
  if (!timeString || typeof timeString !== 'string' || !timeString.match(/^\d{2}:\d{2}$/)) {
    console.warn('Invalid time format for isOutsidePeakPeriod:', timeString);
    return false; // Invalid time format, assume not outside peak period
  }

  const [hoursStr] = timeString.split(':');
  const hours = parseInt(hoursStr, 10);

  // Define peak hours
  const morningPeakStart = 7;   // 7 AM
  const morningPeakEnd = 9;     // 9 AM (exclusive, so up to 08:59)
  const eveningPeakStart = 17;  // 5 PM
  const eveningPeakEnd = 19;    // 7 PM (exclusive, so up to 18:59)

  // Check if the hours fall within any peak period
  const isWithinMorningPeak = (hours >= morningPeakStart && hours < morningPeakEnd);
  const isWithinEveningPeak = (hours >= eveningPeakStart && hours < eveningPeakEnd);

  // Return true if it's NOT within any peak period
  return !(isWithinMorningPeak || isWithinEveningPeak);
};

module.exports = isOutsidePeakPeriod;
