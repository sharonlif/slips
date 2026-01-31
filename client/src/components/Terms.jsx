import './Legal.css';

export function Terms() {
  return (
    <div className="legal-page">
      <div className="legal-content">
        <h1>Terms of Use</h1>
        <p className="legal-updated">Last updated: January 2025</p>

        <section>
          <h2>Acceptance of Terms</h2>
          <p>By accessing and using Slips, you agree to be bound by these Terms of Use. If you do not agree to these terms, please do not use the service.</p>
        </section>

        <section>
          <h2>Description of Service</h2>
          <p>Slips is a note-taking application that allows you to create and manage daily notes. Optional features include Google Calendar integration to view your events alongside notes.</p>
        </section>

        <section>
          <h2>User Accounts</h2>
          <ul>
            <li>You must sign in with a valid Google account to use Slips</li>
            <li>You are responsible for maintaining the security of your account</li>
            <li>You are responsible for all activities that occur under your account</li>
          </ul>
        </section>

        <section>
          <h2>Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the service for any illegal purpose</li>
            <li>Attempt to gain unauthorized access to the service or its systems</li>
            <li>Interfere with or disrupt the service</li>
            <li>Use the service to store or transmit malicious code</li>
          </ul>
        </section>

        <section>
          <h2>Your Content</h2>
          <p>You retain ownership of the notes and content you create in Slips. By using the service, you grant us permission to store and process your content solely to provide the service to you.</p>
        </section>

        <section>
          <h2>Service Availability</h2>
          <p>We strive to keep Slips available, but we do not guarantee uninterrupted access. The service may be temporarily unavailable for maintenance or due to circumstances beyond our control.</p>
        </section>

        <section>
          <h2>Limitation of Liability</h2>
          <p>Slips is provided "as is" without warranties of any kind. We are not liable for any damages arising from your use of the service, including but not limited to loss of data.</p>
        </section>

        <section>
          <h2>Changes to Terms</h2>
          <p>We may update these terms from time to time. Continued use of the service after changes constitutes acceptance of the new terms.</p>
        </section>

        <section>
          <h2>Termination</h2>
          <p>We reserve the right to suspend or terminate your access to the service at any time for violations of these terms or for any other reason.</p>
        </section>

        <a href="/" className="legal-back">Back to Slips</a>
      </div>
    </div>
  );
}
