/**
 * ChanceMachine feedback intake.
 *
 * This file is NOT part of the Angular app build - it's meant to be pasted directly into a
 * Google Sheet's Apps Script editor, where it becomes the backend the Feedback pop-up posts to.
 *
 * Setup:
 * 1. Create (or open) the Google Sheet you want feedback to land in.
 * 2. Extensions > Apps Script.
 * 3. Delete whatever starter code is there and paste this whole file in its place.
 * 4. Run the `setup` function once (select it in the toolbar dropdown, then click Run) - it
 *    creates the "Feedback" sheet/tab with a header row, and this first run is also when Google
 *    will prompt you to authorize the script (it needs permission to edit this spreadsheet).
 * 5. Deploy > New deployment > gear icon > select type "Web app".
 *    - Description: anything you like.
 *    - Execute as: Me.
 *    - Who has access: Anyone.
 *    Click Deploy, and authorize again if prompted.
 * 6. Copy the "Web app" URL it gives you (ends in /exec) into FEEDBACK_ENDPOINT_URL in
 *    src/app/odds-calculator/feedback-dialog/feedback-dialog.ts.
 *
 * Every submission becomes one row: timestamp, type (feedback/bug), message, email (if the
 * sender left one), the page URL, and their browser's user agent string.
 *
 * If you ever change this file, you need to re-deploy (Deploy > Manage deployments > edit the
 * existing deployment > New version) for the change to actually reach the live Web app URL -
 * saving the script alone doesn't update what's already deployed.
 */

const SHEET_NAME = 'Feedback';
const HEADERS = ['Timestamp', 'Type', 'Message', 'Email', 'Page', 'User agent'];

/** Run this once by hand after pasting the script - see the setup steps above. */
function setup() {
  getSheet_();
}

/** Handles the Feedback pop-up's POST request (a plain FormData body, so fields arrive in
 *  e.parameter - no JSON parsing needed). */
function doPost(e) {
  const sheet = getSheet_();
  const p = (e && e.parameter) || {};
  sheet.appendRow([new Date(), p.type || '', p.message || '', p.email || '', p.page || '', p.userAgent || '']);

  MailApp.sendEmail({
    to: 'ptitnico.meyer@gmail.com',
    replyTo: p.email || undefined,
    subject: `[ChanceMachine] Nouveau ${p.type || 'feedback'}`,
    htmlBody: `
      <h2>Nouveau feedback ChanceMachine</h2>

      <p><strong>Type :</strong> ${escapeHtml_(p.type || '')}</p>
      <p><strong>Email :</strong> ${escapeHtml_(p.email || '(non renseigné)')}</p>
      <p><strong>Page :</strong> ${escapeHtml_(p.page || '')}</p>

      <h3>Message</h3>
      <pre>${escapeHtml_(p.message || '')}</pre>

      <h3>User agent</h3>
      <pre>${escapeHtml_(p.userAgent || '')}</pre>
    `
  });

  return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
}

/** Returns the "Feedback" sheet, creating it (with its header row) on first use. */
function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }
  return sheet;
}

function escapeHtml_(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
