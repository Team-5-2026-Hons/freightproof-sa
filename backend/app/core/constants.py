"""Domain constants — values the rules depend on."""

from datetime import timedelta

# Floor for a declared trip duration: below this a schedule is a data-entry
# mistake (typo/unit slip), not a legitimately short run. Raise only with
# evidence, since too high silently rejects real short-haul trips.
MINIMUM_TRIP_DURATION = timedelta(minutes=15)


# Upper bound on one batch review. Batches exist to clear a trip's routine warnings in one
# pass; a request past this is not a dispatcher looking at rows, and one bounded
# transaction keeps the row locks short.
MAX_BATCH_REVIEW_SIZE = 100


# Largest value a Postgres `integer` column holds; filters on one must not exceed it.
PG_INTEGER_MAX = 2_147_483_647
