// Retain 30% of the bonus above normal speed or gain, so inactive effects stay at x1.
export const scaleOverclockMultiplier = multiplier => 1 + (multiplier - 1) * 0.3;
