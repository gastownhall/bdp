# Packed Snapshot/changefeed rendezvous

This isolated test uses a fresh offline-packed installed server and the existing inherited-IPC installed HTTP launcher. Exact custom fixture bytes supply both its advertised fixture identity and its actual Type/schema configuration. No clock/admin seam or production changes are used.

Three real atomic batches create34 Beads and33 unowned Links. The single manifest atpos3 has two real typed streams, each with an emitted continuation. Both complete baseline streams are collected in canonical order, including all full records and endpoint closure. One later normal batch updates a Bead and a Link and creates another Bead atpos4. The exact saved manifest checkpoint is passed verbatim as the exclusive after cursor; finite feed collection follows only emitted next URLs untilnull and must contain exactly the later complete group, never a baseline group.

After commit the same manifest id and original stream URLs still return the complete unchanged baseline with the same identity, checkpoint and expiry. Current HTTP headers report the actual current context; retained body anchor stayspos3. Fresh Resource reads match the later full postimages. Event order/ordinals are checked in semantic operation order; changes are compared by Resource identity because the specification does not prescribe an array order for normalized postimages.

Finite installed evidence only: no persistent client replica, atomic local publication, recovery, History, expiry, foreign-view, SSE or full-profile qualification. Existing passed cases are not rerun. Raw failures, exact package/module/config/source bindings and process/cleanup evidence remain in the bounded external implementation report.
