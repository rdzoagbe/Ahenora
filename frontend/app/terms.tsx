import React from 'react';
import { LegalPage } from '../src/components/LegalPage';

export default function TermsScreen() {
  return (
    <LegalPage
      title="Terms & Support"
      subtitle="Basic testing terms, acceptable use, support contact, and important limitations for the Household COO pre-release app."
      updatedAt="May 2026"
      sections={[
        {
          title: 'Testing release',
          body: 'Household COO is currently being prepared for Google Play testing. Some features may still be marked as testing, preview, or coming soon.',
        },
        {
          title: 'Your responsibilities',
          body: [
            'Use the app only for lawful household organization and family coordination.',
            'Do not upload content you do not have the right to store or process.',
            'Do not use the app for emergencies or critical safety decisions.',
            'Review scanned or AI-assisted results before relying on them.',
          ],
        },
        {
          title: 'Subscriptions and payments',
          body: 'Plan and pricing screens may appear during testing. Paid subscriptions are not active unless clearly stated in the app and processed through an approved payment flow for the distribution channel.',
        },
        {
          title: 'Availability',
          body: 'The app and backend may be unavailable during maintenance, testing, or infrastructure incidents. We aim to provide a reliable service but do not guarantee uninterrupted availability during the testing period.',
        },
        {
          title: 'Support',
          body: 'For support, deletion requests, or privacy questions, contact: rolanddzoagbe@gmail.com. Include your Household COO account email and a short description of the issue.',
        },
      ]}
      footer="These terms are intentionally lightweight for internal and closed testing and should be reviewed before public production launch."
    />
  );
}
