# Installed CONNECT observation routing

The observation helper requests listener port zero so the real child atomically binds
an OS-selected port. All probes must dial the validated `server.dialRoute` returned
from that child's actual ready message. Port zero is an allocation request, not a
remote endpoint. Ordinary HTTP already used the actual route; two raw CONNECT probes
still used the original configuration. Both now use the current child route, without
fallback, retry, timeout change or protocol/runtime change.

The exact CI-failed cold-navigation test is the regression: it checks a complete raw
CONNECT 405 response, four reset peers, a healthy later HTTP request and real stable
reopen. The unchanged source fails on Linux with ECONNREFUSED and locally on macOS with
EADDRNOTAVAIL; the platform-specific errno is not the test oracle. No unrelated passing
installed cases are selected. Existing verified emitted native bytes are reused;
production code is not rebuilt or repacked. This source-built check does not become a
new packed installation/profile qualification claim.
