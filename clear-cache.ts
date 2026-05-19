import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0'),
});

async function main() {
  console.log('正在清除问题类型缓存...\n');
  
  // 清除所有 issue-type 相关的缓存
  const keys = await redis.keys('cache:issue-type:*');
  
  if (keys.length > 0) {
    console.log(`找到 ${keys.length} 个缓存键：`);
    keys.forEach(key => console.log(`  - ${key}`));
    
    const result = await redis.del(...keys);
    console.log(`\n✅ 已删除 ${result} 个缓存键`);
  } else {
    console.log('没有找到相关缓存');
  }
}

main()
  .catch((e) => {
    console.error('❌ 清除缓存失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await redis.quit();
  });
