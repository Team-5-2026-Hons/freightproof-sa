"""Domain constants — values the rules depend on."""

from datetime import timedelta
from decimal import Decimal

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


# Cost rates (FP-294). Bounds shared by the request schema, the cost_profiles CHECK
# constraints and the cost model, so the three can never disagree.
# No real per-km, per-hour or per-trip rate comes near R1,000,000; the cap catches a typo
# (an extra few zeros) before it inflates every figure.
MAX_COST_RATE = Decimal("1000000")
# Road distance is never shorter than the straight line, so a factor below 1 is impossible.
# Above 2 the road would be more than twice the straight line, which no freight lane
# between two depots is; a value that high is almost certainly a typo.
MIN_ROAD_FACTOR = Decimal("1.00")
MAX_ROAD_FACTOR = Decimal("2.00")
# A loaded heavy truck burns roughly 30-60 L/100 km. Above 200 the figure is a typo
# (litres per 1000 km, or an extra digit), not a truck.
MAX_LITRES_PER_100KM = Decimal("200")
