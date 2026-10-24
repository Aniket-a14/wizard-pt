/**
 * "External runner" mode (RUNNER_PROVIDER=manual): this site never executes code. Students copy the
 * runnable program to any online Java compiler, then paste their solution back and submit it for
 * evaluation. Submissions stay `queued` until the admin grades them (`pnpm grade`, which runs the
 * hidden tests in the local Docker sandbox) or reviews them by hand.
 */
export function isExternalRunnerMode(): boolean {
  return (process.env.RUNNER_PROVIDER ?? "").toLowerCase() === "manual";
}
