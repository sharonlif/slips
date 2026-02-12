const { initializeApp } = require('firebase-admin/app');

// Initialize Firebase Admin
initializeApp();

// Export calendar auth functions
const {
  initiateCalendarAuth,
  handleCalendarCallback,
  disconnectCalendar
} = require('./src/calendarAuth');

exports.initiateCalendarAuth = initiateCalendarAuth;
exports.handleCalendarCallback = handleCalendarCallback;
exports.disconnectCalendar = disconnectCalendar;

// Export daily agent functions
const {
  processDaily,
  triggerDailyAgent,
  runDailyAgent
} = require('./src/dailyAgent');

exports.processDaily = processDaily;
exports.triggerDailyAgent = triggerDailyAgent;
exports.runDailyAgent = runDailyAgent;
