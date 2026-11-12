// `results` holds the results of the jobs that the checks job needs, separated by spaces. A job
// passes when it succeeded or its path gate skipped it.
export function collectCheckProblems(results: string): string[] {
  const listed = results.split(' ').filter((result) => result !== '');

  if (listed.length === 0) {
    return ['RESULTS holds no job results'];
  }

  return listed
    .filter((result) => result !== 'success' && result !== 'skipped')
    .map((result) => `a required job ended as ${result}`);
}
