// Fails the checks job unless each job it needs succeeded or was skipped by its path gate. RESULTS
// holds the results of those jobs, separated by spaces.
const results = (process.env['RESULTS'] ?? '').split(' ').filter((result) => result !== '');

if (results.length === 0) {
  console.error('RESULTS holds no job results');
  process.exit(1);
}

const failed = results.filter((result) => result !== 'success' && result !== 'skipped');

for (const result of failed) {
  console.error(`a required job ended as ${result}`);
}

const exitCode = failed.length === 0 ? 0 : 1;

process.exit(exitCode);
