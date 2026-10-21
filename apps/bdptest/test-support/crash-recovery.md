# Installed crash-recovery cohort

Run `transactional-crash-recovery-installed.test.ts` with Node 24.16.0 against an
offline pack/install of the current build. Set `BDP_CRASH_INSTALLED_SERVER` to the
absolute installed `node_modules/@bdp/server/dist` directory and optionally set
`BDP_CRASH_EVIDENCE` to an existing private output directory. The cohort skips
when no installed directory is selected. It compares every emitted server JS
module byte for byte with the installed copy before starting a child.

The test-only resolver redirects exactly the installed transaction runtime's
relative store import to the typed wrapper. That wrapper calls the original
installed store without changing arguments or results. It writes the actual
return to fd3, then parks after durable `admitObserved` or after atomic
`executeObserved` completion. The parent intentionally SIGKILLs that owned child.
The store's `after-terminal` fault hook is inside the transaction and is not used
as a postcommit witness.

Reopen uses the ordinary installed reference-startup facade with no resolver hook
or store wrapper. All mutations, receipt lookups and resource reads use actual
public HTTP. The separate control pipe is not a BDP endpoint. Raw output records
intentional SIGKILL separately from graceful reopen closure and watchdog failure.
Evidence contains synthetic local credentials and must remain private (0600).

These two cases test crash abandonment and committed replay. They do not repeat
the normal restart cohort or establish whole-profile conformance, production
admission, or qualification of the test control shim.
