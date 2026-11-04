// Each query is invented, and names the one email in emails.ts that it was written to find.
// The wording avoids the target's own words where it can, so a match needs meaning, not terms.

export interface Query {
  text: string;
  targetID: string;
}

export const queries: Query[] = [
  { text: 'when does my plane to Portugal leave', targetID: 'e001' },
  { text: 'how much did the rain jacket cost', targetID: 'e003' },
  { text: 'build broke because the database container was slow to start', targetID: 'e005' },
  { text: 'what is the power company charging me this month', targetID: 'e007' },
  { text: 'someone logged into my cloud storage from another country', targetID: 'e015' },
  { text: "restaurant booking for my mother's celebration", targetID: 'e016' },
  { text: 'spreadsheet export breaks when a description has punctuation', targetID: 'e020' },
  { text: 'money back for the returned headphones', targetID: 'e023' },
  { text: 'getting the security deposit back from the landlord', targetID: 'e026' },
  { text: 'injections for the dog', targetID: 'e029' },
  { text: 'plumber coming to fix the dripping faucet', targetID: 'e034' },
  { text: 'why was the payments service slow yesterday afternoon', targetID: 'e044' },
  { text: 'load balancer probes rejected with too many requests', targetID: 'e051' },
  { text: 'boat trip to Spain with the car', targetID: 'e062' },
  { text: 'credentials exposed in pipeline output', targetID: 'e068' },
  { text: 'who is looking after the cat during the trip', targetID: 'e086' },
  { text: 'what time do I start on my first day at the new job', targetID: 'e091' },
  { text: 'lessons from breaking up a monolith into microservices', targetID: 'e099' },
  { text: 'how long are deleted files kept in backups', targetID: 'e100' },
  { text: 'is the water going to be turned off', targetID: 'e040' },
];
