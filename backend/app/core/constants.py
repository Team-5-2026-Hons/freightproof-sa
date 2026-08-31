"""Domain constants — values the rules depend on, in one readable place.

A threshold inlined at its call site is a threshold nobody reviews, and one that
quietly acquires a second, different copy the next time the rule is needed.
"""

from datetime import timedelta

# The shortest schedule a trip may declare.
#
# Rejecting only "arrival after departure" lets a Johannesburg-Durban run be booked
# as sixty seconds, and nothing downstream ever questions it: the phase ledger
# records against that schedule, and every latency figure derived from phase_events
# inherits the nonsense. Refusing it at creation is far cheaper than detecting a
# corrupt duration after the trip has been anchored.
#
# Fifteen minutes is deliberately permissive. It is not an estimate of how long real
# freight takes — it is a floor beneath which a declared duration is not a mistake in
# degree but a mistake in kind (a typo, a unit slip, a test payload). The shortest
# plausible real movement here is a cross-dock shuttle between neighbouring depots,
# which comfortably clears it. Raise this only with evidence about actual trip
# durations: too high silently rejects legitimate short runs, which is a worse
# failure than the one it guards against, because the dispatcher cannot work around it.
MINIMUM_TRIP_DURATION = timedelta(minutes=15)
