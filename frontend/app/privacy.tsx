import React from 'react';
import { LegalPage } from '../src/components/LegalPage';

export default function PrivacyScreen() {
  return (
    <LegalPage
      title="Privacy Policy"
      subtitle="How Household COO handles family operations data, account data, calendar imports, photos, notifications, and support requests."
      updatedAt="May 2026"
      sections={[
        {
          title: 'Information we collect',
          body: [
            'Account profile information from Google sign-in, including name, email address, profile photo, and Google account identifier.',
            'Household information such as family members, roles, invites, tasks, cards, kids rewards, stars, PIN state, and app preferences.',
            'Content you add to the app, including card titles, descriptions, due dates, vault document titles/categories/images, scanned images, and calendar imports you choose to sync.',
            'Notification settings and device push tokens when you enable reminders or new-card alerts.',
          ],
        },
        {
          title: 'How we use information',
          body: [
            'To create and secure your account session.',
            'To display and sync your household cards, calendar items, vault documents, kids rewards, invites, and notification preferences.',
            'To process scans or other AI-assisted features when you choose to use them.',
            'To send app notifications, invite links, service messages, and support responses.',
          ],
        },
        {
          title: 'Calendar and document data',
          body: 'Calendar sync is user-initiated. Imported calendar data is used to create Household COO cards and discover inviteable contacts. Vault images and document records are stored so you can view and manage them inside your household workspace.',
        },
        {
          title: 'Children and family data',
          body: 'Kids profiles, stars, rewards, and PIN settings are managed by the signed-in household user. The app is intended for household organization by parents or guardians, not independent use by children without parental supervision.',
        },
        {
          title: 'Sharing and processors',
          body: [
            'We do not sell personal data.',
            'Data may be processed by infrastructure and service providers used to operate the app, including hosting, database, email delivery, authentication, notification delivery, and AI processing providers.',
            'Invite links may expose the invited email address, inviter name, and household join context to the recipient.',
          ],
        },
        {
          title: 'Security and retention',
          body: 'Authentication tokens are stored using secure device storage where available. Data is retained while your account or household remains active, unless deletion is requested or required by law.',
        },
        {
          title: 'Your choices',
          body: [
            'You can sign out from Settings.',
            'You can disable notification preferences in Settings.',
            'You can delete cards, vault documents, rewards, and invites where the app provides those controls.',
            'You can request account and data deletion from the Account deletion screen.',
          ],
        },
        {
          title: 'Contact',
          body: 'For privacy or deletion requests, contact: rolanddzoagbe@gmail.com. Include the Google account email used for Household COO so the request can be matched to the correct account.',
        },
      ]}
      footer="This policy is provided for the current Household COO testing release and should be reviewed before production launch."
    />
  );
}
