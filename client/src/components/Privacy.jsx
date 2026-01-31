import './Legal.css';

export function Privacy() {
  return (
    <div className="legal-page">
      <div className="legal-content">
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated: January 2025</p>

        <section>
          <h2>Information We Collect</h2>
          <p>When you use Slips, we collect:</p>
          <ul>
            <li><strong>Account information:</strong> Your email address and name when you sign in with Google.</li>
            <li><strong>Notes content:</strong> The notes you create and store in the app.</li>
            <li><strong>Calendar data:</strong> If you connect your Google Calendar, we access your calendar list and event information (titles, times, descriptions) to display in the app.</li>
          </ul>
        </section>

        <section>
          <h2>How We Use Your Information</h2>
          <ul>
            <li>To provide and maintain the Slips service</li>
            <li>To authenticate your account</li>
            <li>To sync and display your notes across devices</li>
            <li>To display calendar events alongside your notes (if calendar is connected)</li>
          </ul>
        </section>

        <section>
          <h2>Data Storage</h2>
          <p>Your data is stored securely using Google Firebase services. Notes and calendar connection data are associated with your user account and are only accessible to you.</p>
        </section>

        <section>
          <h2>Third-Party Services</h2>
          <p>We use the following third-party services:</p>
          <ul>
            <li><strong>Google Firebase:</strong> For authentication, database, and hosting</li>
            <li><strong>Google Calendar API:</strong> To access your calendar data (only if you grant permission)</li>
          </ul>
        </section>

        <section>
          <h2>Data Sharing</h2>
          <p>We do not sell, trade, or share your personal information with third parties, except as required to provide the service (e.g., storing data on Firebase) or as required by law.</p>
        </section>

        <section>
          <h2>Your Rights</h2>
          <p>You can:</p>
          <ul>
            <li>Access and export your notes at any time</li>
            <li>Disconnect your calendar connection at any time</li>
            <li>Delete your account and all associated data by contacting us</li>
          </ul>
        </section>

        <section>
          <h2>Contact</h2>
          <p>For questions about this privacy policy, please contact us through the app.</p>
        </section>

        <a href="/" className="legal-back">Back to Slips</a>
      </div>
    </div>
  );
}
