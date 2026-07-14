import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.config import settings

async def main():
    engine = create_async_engine(settings.DATABASE_URL)
    async with engine.begin() as conn:
        res = await conn.execute(text("SELECT id, organization_id, email FROM users"))
        print("users:", res.fetchall())
        res2 = await conn.execute(text("SELECT id, name FROM organizations"))
        print("organizations:", res2.fetchall())
        
if __name__ == "__main__":
    asyncio.run(main())
