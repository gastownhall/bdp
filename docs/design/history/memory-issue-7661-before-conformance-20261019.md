This proposal gives agents deterministically discoverable constraints on behavior, side effects, and outcomes, with explicit relationships for applicability, necessary obligations, contribution, satisfaction, and breach.

Read the [complete proposal, examples, and structured Type catalog](https://github.com/gastownhall/bdp/blob/b4b2249423e777a8241819c37ed2a77267159514/specs/types/memory/memory.md). That immutable source is the current proposal; this issue is its review and discussion entry point.

The common model uses **Constraint**, with Policy, Decision, Procedure, Requirement, Scenario, and Specification conforming to it. Plain **Memory** holds other knowledge and can identify concrete results. No separate Implementation Type is needed.

**Subject To, Addresses, Satisfies, and Violates accept any Bead as their source**, including Issues, and Constraint-family targets. Subject To is transitive and exposes necessary obligations through Requires, including Defines. Defines adds the defining-parent tree. Satisfies specializes Addresses; Violates is a separate References specialization. Superseded By expresses retirement to a replacement identity.

Explicit Subject To Links and matching applicability predicates independently include subjects. Matches implicitly derive relationships without storing Links; non-matches do not cancel explicit obligations. A stated exception can support an explicit Satisfies claim explaining N/A. Multiple assessment claims retain their evidence and provenance; missing evidence or claims do not establish violation, and conflicting claims remain visible.

Publication deliberately defers pin/revision mechanics, executable predicate representation/evaluation and authority, conditional dependency overrides, structured sufficiency and assessment/evidence reconciliation, exact query/CLI grammar, and detailed shared lifecycle integration. The [scope table](https://github.com/gastownhall/bdp/blob/b4b2249423e777a8241819c37ed2a77267159514/specs/types/memory/memory.md#publication-scope-and-deferred-specification-work) gives the baseline retained for each deferral. The abstract applicability property is not an installed executable predicate schema or a supported evaluator.

This is a **published design draft**, not BDP adoption, runtime support, release qualification, or a change to integration holds. [PR143](https://github.com/gastownhall/bdp/pull/143) carries the source. [Publication notes and historical-artifact boundaries](https://github.com/gastownhall/bdp/blob/b4b2249423e777a8241819c37ed2a77267159514/specs/types/memory/README.md) and the [documentation validation receipt](https://github.com/gastownhall/bdp/blob/b4b2249423e777a8241819c37ed2a77267159514/docs/design/memory-catalog-publication-20261019.json) identify what was checked. Older property fixtures and their successful results do not validate this revised catalog.

The [previous issue body](https://github.com/gastownhall/bdp/blob/b4b2249423e777a8241819c37ed2a77267159514/docs/design/history/memory-issue-7661-before-20261019.md) is preserved as review history.

Source revision: `b4b2249423e777a8241819c37ed2a77267159514`; catalog SHA256: `0a0ce8473459648569ef626f19d33af9314b75d773a6c29c4f0f7f58f2dcab81`.
