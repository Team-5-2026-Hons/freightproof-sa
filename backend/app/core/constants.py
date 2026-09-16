"""Domain constants — values the rules depend on."""

from datetime import timedelta

# Floor for a declared trip duration: below this a schedule is a data-entry
# mistake (typo/unit slip), not a legitimately short run. Raise only with
# evidence, since too high silently rejects real short-haul trips.
MINIMUM_TRIP_DURATION = timedelta(minutes=15)
