// Fails the checks job unless each job it needs succeeded or was skipped by its path gate. RESULTS
// holds the results of those jobs, separated by spaces.
import { collectCheckProblems } from './collect-check-problems.ts';

const problems = collectCheckProblems(process.env['RESULTS'] ?? '');

for (const problem of problems) {
  console.error(problem);
}

const exitCode = problems.length === 0 ? 0 : 1;

process.exit(exitCode);
