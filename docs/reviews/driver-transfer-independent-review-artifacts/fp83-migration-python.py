import os
import sys
import runpy
os.environ.clear()
os.environ.update({
 'PATH':'/opt/homebrew/bin:/usr/bin:/bin', 'DYLD_FALLBACK_LIBRARY_PATH':'/opt/homebrew/lib',
 'PYTHONPATH':'/tmp/fp83-no-dotenv',
 'DATABASE_URL':'postgresql+asyncpg://fp83_review@127.0.0.1:55573/fp83_migrations',
 'TEST_DATABASE_URL':'postgresql+asyncpg://fp83_review@127.0.0.1:55573/fp83_migrations',
 'REDIS_URL':'redis://127.0.0.1:55574/1','SUPABASE_URL':'https://test.supabase.co',
 'SUPABASE_ANON_KEY':'test-anon-key','SUPABASE_SERVICE_ROLE_KEY':'test-service-role-key',
 'HEDERA_ACCOUNT_ID':'0.0.0','HEDERA_PRIVATE_KEY':'test-hedera-key',
})
from pydantic_settings.sources import DotEnvSettingsSource
DotEnvSettingsSource._read_env_files=lambda self:{}
sys.path.insert(0, sys.argv[1])
runpy.run_path(sys.argv[2],run_name='__main__')
