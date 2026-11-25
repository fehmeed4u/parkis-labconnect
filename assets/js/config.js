// App settings. Edit these after you set up the Google Sheet backend (see README).
export const CONFIG = {
  // 'demo'  = runs entirely in this browser with sample data (good for trying it out).
  // 'live'  = uses your Google Sheet through the Apps Script web app below.
  MODE: 'demo',

  // Apps Script web-app URL, ending in /exec  (Deploy → Manage deployments → Web app URL)
  API_URL: '',

  // Google OAuth client ID (Google Cloud console → APIs & Services → Credentials)
  GOOGLE_CLIENT_ID: '',

  // Optional: only accounts from this domain can sign in, e.g. 'parkis.pt'
  SCHOOL_DOMAIN: ''
};
