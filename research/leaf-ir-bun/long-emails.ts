import type { Email } from './emails.ts';

// Two invented emails of several hundred tokens each, to time the model near its 512-token limit.

export const longEmails: Email[] = [
  {
    id: 'e099',
    subject: 'Long read: what we learned migrating a monolith to services over two years',
    body: [
      'Two years ago our team ran a single application that handled billing, accounts, notifications and reporting, deployed as one unit several times a day. It worked, until it did not. Deploys took forty minutes, a bug in the reporting code could take down checkout, and nobody felt they owned any one part of the system.',
      'We started by drawing the boundaries we already had. Billing and accounts talked to each other constantly, so splitting them first would have turned function calls into network calls with no benefit. Notifications, on the other hand, only ever received events, which made it the obvious first service to pull out.',
      'The first extraction took four months instead of the six weeks we planned. Most of the time went on things nobody had written down: retries that the old code did implicitly, a cron job that cleaned up stuck emails, and a report that read directly from the notifications table. Each of these became a ticket, and each ticket taught us something about the next extraction.',
      'We learned to put an event log between services early. Once every service published its changes to the log, new consumers could be added without asking the producing team for anything, and a broken consumer could be rebuilt by replaying the log from the start. Replays were slow at first, so we added periodic snapshots.',
      'We also learned what not to split. Reporting stayed as a read-only consumer of the log rather than becoming a service with its own writes. That single decision removed a whole class of consistency bugs, because there was only ever one writer for each piece of data.',
      'By the end, deploys took eight minutes, each team owned two or three services, and on-call pages dropped by about a third. The cost was real: more infrastructure to run, more dashboards to read, and a steeper path for new joiners. We would make the same decision again, but we would start with the event log instead of finishing with it.',
      'If you are considering a similar move, write down every implicit behaviour of the code you plan to extract before you move a line of it. Run the old and new paths side by side and compare outputs for at least a week. And measure deploy time and incident counts before you start, so you know whether the change helped.',
    ].join('\n\n'),
  },
  {
    id: 'e100',
    subject: 'Terms of service update for Quillbox',
    body: [
      'We are updating the Quillbox terms of service and privacy policy. The changes take effect on 1 January. If you keep using Quillbox after that date, you agree to the updated terms.',
      'What is changing: we are clarifying how long we keep deleted files. Files you delete stay in your bin for 30 days, and are then removed from our main storage. Copies in our backups are overwritten within a further 60 days. Shared links to a deleted file stop working straight away.',
      'We are also changing how we handle accounts that have been inactive for a long time. If you do not sign in for 24 months, we will email you at least twice before we remove your account. You can keep your account active by signing in once.',
      'We have added a section on automated processing. We scan uploaded files for malware and for content that breaks the law, and we may suspend a shared link while we review it. We do not use the content of your files to train any models, and we do not sell your data.',
      'Finally, we have updated the list of countries where our subprocessors store data, and the section on how to contact our data protection officer. You can read the full terms, and a summary of every change, on our website. If you have questions, reply to this email and our support team will help.',
    ].join('\n\n'),
  },
];
