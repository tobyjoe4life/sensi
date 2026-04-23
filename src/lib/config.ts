/**
 * sensi — renderer-side personal-use configuration flags.
 *
 * When PERSONAL_USE is true the renderer suppresses trial / donation /
 * quota UI surfaces that were inherited from the upstream commercial product.
 * See DECISIONS.md D001/D003/D006 and TASKS.md M0-T6.
 *
 * This flag is intentionally a compile-time constant, not an env var or a
 * runtime setting — sensi is not a commercial product and there is no
 * scenario where the trial UI should come back. The gates below should all
 * be eliminated (and the gated components deleted) in M1-T8 cleanup.
 */
export const PERSONAL_USE = true as const;
