# Draft wording for Trish: accepted retained-minimum ruling

Status: implementation note applying Donna's direct answer to ROOT question `call_dc2b90475ebd48caa497c0c2bca8eb0f`. This is a proposed narrow amendment for canonical incorporation, not an edit or replacement of the agreed397107-byte specification (SHA256 `67772742d7d08f48c12196e9789f1859ad2d0e19f133ea65e197b049361f84f8`).

For a known, valid, unexpired retained Snapshot manifest or issued continuation page, with matching Scope epoch and Authorization View, a syntactically valid minimum position whose order cannot be established uses the authority's existing bounded minimum-proving deadline. If still unproved at that deadline, the response is503 `temporarily-unavailable`, `retry: after-delay`. It does not report a proved comparison, `snapshot-position-too-old`, or a current-resource `catch-up-timeout`.

The Snapshot's saved position and expiry remain unchanged. The authority neither reanchors the Snapshot at the current head nor renews its lifetime while proving the minimum. Already expired matching-context handles retain410-before-minimum; a comparable minimum beyond the saved position retains immediate409 `snapshot-position-too-old`.

This does not decide foreign-view plus expiry collisions, undisclosable/unknown identity ordering, erased-history permission, or premature loss of an available captured page. Existing budgets, authentication, non-disclosure, cancellation and current serving-context rules remain in force. No new discovery member, public API or configuration switch is introduced.
