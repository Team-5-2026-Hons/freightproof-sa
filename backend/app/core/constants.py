"""Domain constants — values the rules depend on."""

from datetime import timedelta
from decimal import Decimal

MINIMUM_TRIP_DURATION = timedelta(minutes=15)


MAX_BATCH_REVIEW_SIZE = 100


MAX_EXCEPTION_PHOTOS = 5


PG_INTEGER_MAX = 2_147_483_647


MAX_COST_RATE = Decimal("1000000")
MIN_ROAD_FACTOR = Decimal("1.00")
MAX_ROAD_FACTOR = Decimal("2.00")
MAX_LITRES_PER_100KM = Decimal("200")
