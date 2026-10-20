import os
import sys
from pathlib import Path

# All targets belong to the disposable review containers; no application dotenv.
os.environ.clear()
os.environ.update({
    'PATH': '/opt/homebrew/bin:/usr/bin:/bin',
    'PYTHONPATH': '/tmp/fp83-no-dotenv',
    'DYLD_FALLBACK_LIBRARY_PATH': '/opt/homebrew/lib',
    'DATABASE_URL': 'postgresql+asyncpg://fp83_review@127.0.0.1:55573/' + ('fp83_migrations' if sys.argv[1] == 'alembic' else 'fp83_review'),
    'TEST_DATABASE_URL': 'postgresql+asyncpg://fp83_review@127.0.0.1:55573/fp83_review',
    'REDIS_URL': 'redis://127.0.0.1:55574/0',
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_ANON_KEY': 'test-anon-key',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-service-role-key',
    'HEDERA_ACCOUNT_ID': '0.0.0', 'HEDERA_PRIVATE_KEY': 'test-hedera-key',
})
from pydantic_settings.sources import DotEnvSettingsSource
DotEnvSettingsSource._read_env_files = lambda self: {}
sys.path.insert(0, '/Users/ciaranformby/dev/freightproof-sa-4/backend')
if sys.argv[1] == 'alembic':
    from alembic.config import main
    main(argv=sys.argv[2:])
else:
    import pytest
    raise SystemExit(pytest.main(sys.argv[2:]))
