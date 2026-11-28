// App settings. Edit these after you set up the Google Sheet backend (see README).
export const CONFIG = {
  // Apps Script web-app URL, ending in /exec  (Deploy → Manage deployments → Web app URL).
  // While this is empty the app keeps its data in this browser only (for setting up and testing).
  // Paste the URL here and it uses your Google Sheet instead.
  API_URL: 'https://script.google.com/macros/s/AKfycbzHvWqKJbq2jYgC0IVGBajm9ZfCH9k-QUUBficj0tyzcGdt88Au7Oje4yztv5ce0ZJD/exec',

  // Google OAuth client ID (Google Cloud console → APIs & Services → Credentials)
  GOOGLE_CLIENT_ID: '',

  // Optional: only accounts from this domain can sign in, e.g. 'parkis.pt'
  SCHOOL_DOMAIN: ''
};
