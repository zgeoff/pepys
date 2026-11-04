// Every fixture here is invented: no real person's mail, issue or name.

export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface NoulQuestion {
  type: 'noul';
  instructions: string;
}

export type Question = ChoiceQuestion | NoulQuestion;

export interface SystemOneRequest {
  model: string;
  state: Record<string, string>;
  questions: Record<string, Question>;
}

export interface SpikeRequest {
  name: 'fixed-label-set' | 'candidate-set' | 'per-pair';
  body: SystemOneRequest;
}

export function buildSpikeRequests(model: string): SpikeRequest[] {
  return [
    { name: 'fixed-label-set', body: buildFixedLabelRequest(model) },
    { name: 'candidate-set', body: buildCandidateSetRequest(model) },
    { name: 'per-pair', body: buildPerPairRequest(model) },
  ];
}

const invoiceMail = {
  from: 'billing@lanternworks.example',
  subject: 'Invoice LW-2207 for October',
  body: 'Hello, attached is invoice LW-2207 for the October hosting plan, 48.00 EUR, due on 15 November. Reply to this address with any questions.',
};

function buildFixedLabelRequest(model: string): SystemOneRequest {
  return {
    model,
    state: invoiceMail,
    questions: {
      label: {
        type: 'choice',
        instructions: 'What kind of email is this?',
        criteria: {
          invoice: 'A bill, receipt or payment request',
          newsletter: 'A mailing list or marketing message sent to many people',
          personal: 'A message written by one person to the reader',
          notification: 'An automated message about an account or a service event',
          other: 'An email that fits none of the other labels',
        },
      },
    },
  };
}

const bugReportMail = {
  from: 'ines.okafor@quillmoth.example',
  subject: 'Export stops at 10,000 rows',
  body: 'Hi, since Tuesday the CSV export from the reports page stops after exactly 10,000 rows and gives no error. Smaller reports export fine. Is a limit new?',
};

const candidateIssues = {
  issue_41: 'Reports page loads slowly when a filter has more than 20 tags',
  issue_57: 'CSV export truncates large reports without an error',
  issue_63: 'Dark mode renders chart labels in black',
  issue_70: 'Password reset email arrives twice',
  issue_88: 'Add a PDF export to the reports page',
};

// The candidate-set request pairs the Choice with a Noul, the vendor's documented
// way to tell "none of these" apart from a weak pick (docs.typesafe.ai/patterns/companion-noul).
function buildCandidateSetRequest(model: string): SystemOneRequest {
  return {
    model,
    state: { email: JSON.stringify(bugReportMail), issues: JSON.stringify(candidateIssues) },
    questions: {
      issue: {
        type: 'choice',
        instructions: 'Which of the issues in `issues` does `email` report or discuss?',
        criteria: candidateIssues,
      },
      any_issue: {
        type: 'noul',
        instructions: 'Does `email` report or discuss any of the issues in `issues`?',
      },
    },
  };
}

function buildPerPairRequest(model: string): SystemOneRequest {
  const questions: Record<string, Question> = {};

  for (const [issueID, title] of Object.entries(candidateIssues)) {
    questions[issueID] = {
      type: 'choice',
      instructions: `Is \`email\` related to this issue: "${title}"?`,
      criteria: {
        related: 'The email reports or discusses this issue',
        unrelated: 'The email is about something else',
        unclear: 'The email gives too little detail to tell',
      },
    };
  }

  return { model, state: { email: JSON.stringify(bugReportMail) }, questions };
}
