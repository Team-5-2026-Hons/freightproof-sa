import os
import subprocess

root = '/Users/ciaranformby/dev/freightproof-sa-4'
# The actual hook is unchanged. These targets are dedicated disposable containers.
environment = {
    'PATH': '/opt/homebrew/bin:/usr/bin:/bin',
    'PYTHONPATH': '/tmp/fp83-no-dotenv',
    'DYLD_FALLBACK_LIBRARY_PATH': '/opt/homebrew/lib',
    'DATABASE_URL': 'postgresql+asyncpg://fp83_review@127.0.0.1:55573/fp83_review',
    'TEST_DATABASE_URL': 'postgresql+asyncpg://fp83_review@127.0.0.1:55573/fp83_review',
    'REDIS_URL': 'redis://127.0.0.1:55574/0',
    'SUPABASE_URL': 'https://test.supabase.co',
    'SUPABASE_ANON_KEY': 'test-anon-key',
    'SUPABASE_SERVICE_ROLE_KEY': 'test-service-role-key',
    'HEDERA_ACCOUNT_ID': '0.0.0',
    'HEDERA_PRIVATE_KEY': 'test-hedera-key',
}
result = subprocess.run(
    ['/bin/bash', root + '/.codex/hooks/test-summary.sh'],
    cwd=root, env=environment, input='{"stop_hook_active": false}', text=True,
    check=False,
)
print('Actual unchanged stop-hook exit code:', result.returncode)
raise SystemExit(result.returncode)
