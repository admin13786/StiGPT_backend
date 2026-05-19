import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // 删除所有旧的游戏相关问题类型
  const oldIssueTypes = [
    '充值未到账',
    '账号被盗',
    '游戏无法登录',
    '游戏闪退/卡顿',
    '道具丢失',
    '活动奖励问题',
    '其他问题',
    '游戏BUG',
    '账号封禁申诉',
    '实名认证问题',
    '好友/社交问题',
    '游戏玩法咨询',
  ];

  for (const name of oldIssueTypes) {
    const deleted = await prisma.issueType.deleteMany({
      where: { name },
    });
    if (deleted.count > 0) {
      console.log(`✓ 删除旧问题类型: ${name}`);
    }
  }

  console.log('\n✅ 清理完成！');
}

main()
  .catch((e) => {
    console.error('❌ 清理失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
