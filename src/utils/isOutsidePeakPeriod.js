// backend/utils/isOutsidePeakPeriod.js

/**
 * Determines if a given time string falls outside predefined peak periods.
 * Peak periods are defined as 7 AM - 9 AM and 5 PM - 7 PM (17:00 - 19:00).
 *
 * @param {string} timeStr - The time in "HH:MM" format (e.g., "08:30", "17:45").
 * @returns {boolean} - True if the time is outside peak period, false otherwise or if input is invalid.
 */
export const isOutsidePeakPeriod = (timeStr) => {
  if (!timeStr) return false;

  const [hours, minutes] = timeStr.split(':').map(Number);
  if (isNaN(hours) || isNaN(minutes)) return false;

  const time = hours * 60 + minutes;
  const peakStartMorning = 7 * 60;  // 7:00
  const peakEndMorning = 10 * 60;   // 10:00
  const peakStartEvening = 17 * 60; // 17:00
  const peakEndEvening = 20 * 60;   // 20:00

  return (time < peakStartMorning || 
          (time > peakEndMorning && time < peakStartEvening) || 
          time > peakEndEvening);
};
