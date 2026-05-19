import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

// 密码哈希函数
function hashPassword(password: string): string {
  // 使用 bcrypt 加密密码
  return bcrypt.hashSync(password, 10);
}

const prisma = new PrismaClient();

// 重试函数
async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delay: number = 1000,
): Promise<T> {
  let lastError: Error;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        console.warn(`⚠️  操作失败，${delay}ms 后重试 (${i + 1}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError!;
}

async function main() {
  console.log('🌱 开始初始化数据库...\n');

  // 检查必要的环境变量
  if (!process.env.DATABASE_URL) {
    console.error('❌ 错误: DATABASE_URL 环境变量未设置');
    process.exit(1);
  }

  try {
    // 如果设置了 SKIP_SEED 环境变量，直接跳过
    if (process.env.SKIP_SEED === 'true') {
      console.log('⏭️  跳过种子数据初始化 (SKIP_SEED=true)');
      return;
    }

    // 检查数据库是否已初始化（通过检查是否存在管理员账户）
    const existingAdmin = await prisma.user.findFirst({
      where: {
        role: 'ADMIN',
        username: 'admin',
      },
    });

    if (existingAdmin) {
      console.log('✅ 数据库已初始化，跳过种子数据创建');
      console.log('💡 提示: 如需重新初始化，请设置 SKIP_SEED=false 或删除管理员账户');
      return;
    }

    console.log('📝 检测到新数据库，开始初始化种子数据...\n');

  // 1. 创建初始管理员账户
  const adminUsers = [
    {
      username: 'admin',
      password: 'admin123',
      role: 'ADMIN' as const,
      realName: '系统管理员',
      email: 'admin@example.com',
      phone: '13800000001',
    },
    {
      username: 'admin2',
      password: 'admin123',
      role: 'ADMIN' as const,
      realName: '副管理员',
      email: 'admin2@example.com',
      phone: '13800000002',
    },
  ];

    // 1. 创建初始管理员账户（幂等性：使用 upsert）
    for (const userData of adminUsers) {
      await retry(async () => {
        const hashedPassword = hashPassword(userData.password);
        const user = await prisma.user.upsert({
          where: { username: userData.username },
          update: {
            // 如果用户已存在，更新密码（确保密码是最新的）
            password: hashedPassword,
            realName: userData.realName,
            email: userData.email,
            phone: userData.phone,
          },
          create: {
            username: userData.username,
            password: hashedPassword,
            role: userData.role,
            realName: userData.realName,
            email: userData.email,
            phone: userData.phone,
          },
        });
        console.log(`✓ 管理员账户: ${user.username} (${userData.realName})`);
      });
    }

    // 2. 创建示例客服账户（幂等性：使用 upsert）
    const agentUsers = [
    {
      username: 'agent1',
      password: 'agent123',
      role: 'AGENT' as const,
      realName: '客服001',
      email: 'agent1@example.com',
      phone: '13800001001',
    },
    {
      username: 'agent2',
      password: 'agent123',
      role: 'AGENT' as const,
      realName: '客服002',
      email: 'agent2@example.com',
      phone: '13800001002',
    },
    {
      username: 'agent3',
      password: 'agent123',
      role: 'AGENT' as const,
      realName: '客服003',
      email: 'agent3@example.com',
      phone: '13800001003',
    },
  ];

    for (const userData of agentUsers) {
      await retry(async () => {
        const hashedPassword = hashPassword(userData.password);
        const user = await prisma.user.upsert({
          where: { username: userData.username },
          update: {
            password: hashedPassword,
            realName: userData.realName,
            email: userData.email,
            phone: userData.phone,
          },
          create: {
            username: userData.username,
            password: hashedPassword,
            role: userData.role,
            realName: userData.realName,
            email: userData.email,
            phone: userData.phone,
          },
        });
        console.log(`✓ 客服账户: ${user.username} (${userData.realName})`);
      });
    }

    // 3. 创建示例游戏配置（幂等性：使用 upsert，更新时不覆盖已存在的 API Key）
    const games = [
      {
        name: '弹弹堂',
        difyApiKey: 'your-dify-api-key-here',
        difyBaseUrl: 'http://ai.sh7road.com/v1',
      },
      {
        name: '神曲',
        difyApiKey: 'your-dify-api-key-here',
        difyBaseUrl: 'http://ai.sh7road.com/v1',
      },
    ];

    for (const gameData of games) {
      await retry(async () => {
        // 检查游戏是否已存在
        const existing = await prisma.game.findUnique({
          where: { name: gameData.name },
        });

        const game = await prisma.game.upsert({
          where: { name: gameData.name },
          update: {
            // 如果游戏已存在，更新 API Key 和 BaseUrl（仅在 seed 中提供了有效值时）
            // 如果 API Key 是占位符，则不更新（保持现有配置）
            ...(gameData.difyApiKey && gameData.difyApiKey !== 'your-dify-api-key-here' 
              ? { difyApiKey: gameData.difyApiKey } 
              : {}),
            difyBaseUrl: gameData.difyBaseUrl,
          },
          create: {
            name: gameData.name,
            icon: null,
            enabled: true,
            difyApiKey: gameData.difyApiKey,
            difyBaseUrl: gameData.difyBaseUrl,
          },
        });
        console.log(`✓ 游戏配置: ${game.name}`);
      });
    }

    // 4. 创建问题类型（科研咨询类型）
    const issueTypes = [
      {
        name: '文献检索与阅读',
        description: '文献查找、文献阅读理解、文献综述等',
        enabled: true,
        requireDirectTransfer: false,
        priorityWeight: 50,
      },
      {
        name: '实验设计与方法',
        description: '实验方案设计、研究方法选择、数据采集等',
        enabled: true,
        requireDirectTransfer: false,
        priorityWeight: 60,
      },
      {
        name: '数据分析与统计',
        description: '数据处理、统计分析、结果解读等',
        enabled: true,
        requireDirectTransfer: false,
        priorityWeight: 70,
      },
      {
        name: '论文写作与投稿',
        description: '论文撰写、期刊选择、投稿流程等',
        enabled: true,
        requireDirectTransfer: false,
        priorityWeight: 60,
      },
      {
        name: '科研工具使用',
        description: '软件工具、编程语言、数据库使用等',
        enabled: true,
        requireDirectTransfer: false,
        priorityWeight: 50,
      },
      {
        name: '学术规范与伦理',
        description: '学术诚信、引用规范、伦理审查等',
        enabled: true,
        requireDirectTransfer: false,
        priorityWeight: 80,
      },
      {
        name: '项目申请与管理',
        description: '基金申请、项目管理、经费使用等',
        enabled: true,
        requireDirectTransfer: true,
        priorityWeight: 90,
      },
      {
        name: '其他科研问题',
        description: '其他科研相关咨询',
        enabled: true,
        requireDirectTransfer: false,
        priorityWeight: 40,
      },
    ];

    for (const issueTypeData of issueTypes) {
      await retry(async () => {
        const existing = await prisma.issueType.findFirst({
          where: { name: issueTypeData.name },
        });

        if (!existing) {
          const issueType = await prisma.issueType.create({
            data: issueTypeData,
          });
          console.log(`✓ 咨询类型: ${issueType.name}`);
        } else {
          console.log(`✓ 咨询类型已存在: ${issueTypeData.name}`);
        }
      });
    }

    // 5. 创建示例紧急排序规则（幂等性：检查是否存在）
    const rules = [
      {
        name: '充值问题优先',
        enabled: true,
        priorityWeight: 80,
        description: '充值相关问题的优先级规则',
        conditions: {
          keywords: ['充值', '支付', '付款'],
          identityStatus: 'VERIFIED_PAYMENT',
        },
      },
      {
        name: '紧急工单优先',
        enabled: true,
        priorityWeight: 90,
        description: '标记为紧急的工单优先处理',
        conditions: {
          priority: 'URGENT',
        },
      },
    ];

    for (const ruleData of rules) {
      await retry(async () => {
        const existing = await prisma.urgencyRule.findFirst({
          where: { name: ruleData.name },
        });

        if (!existing) {
          const rule = await prisma.urgencyRule.create({
            data: ruleData,
          });
          console.log(`✓ 紧急排序规则: ${rule.name}`);
        } else {
          console.log(`✓ 紧急排序规则已存在: ${ruleData.name}`);
        }
      });
    }

    console.log('\n✅ 数据库初始化完成！');
    console.log('\n📋 默认账户信息:');
    console.log('\n  管理员账户:');
    console.log('    - admin / admin123 (系统管理员)');
    console.log('    - admin2 / admin123 (副管理员)');
    console.log('\n  客服账户:');
    console.log('    - agent1 / agent123 (客服001)');
    console.log('    - agent2 / agent123 (客服002)');
    console.log('    - agent3 / agent123 (客服003)');
    console.log('\n📊 初始化数据:');
    console.log(`  游戏配置: ${games.length} 个`);
    console.log(`  咨询类型: ${issueTypes.length} 个`);
    console.log(`  紧急排序规则: ${rules.length} 个`);
    console.log('\n⚠️  重要提示:');
    console.log('  1. 所有账户的默认密码都是 "admin123" 或 "agent123"');
    console.log('  2. 请在生产环境中立即修改所有账户的密码！');
    console.log('  3. 建议为每个账户设置强密码（至少8位，包含字母和数字）');
    console.log('  4. 可以通过管理端修改账户密码');
    console.log('  5. 游戏配置中的 Dify API Key 需要手动配置');
  } catch (error) {
    console.error('\n❌ 数据库初始化失败！');
    console.error('错误详情:', error);
    console.error('\n💡 排查建议:');
    console.error('  1. 检查数据库连接是否正常');
    console.error('  2. 检查数据库用户权限是否足够');
    console.error('  3. 检查 Prisma schema 是否与数据库结构一致');
    console.error('  4. 查看上方错误信息，定位具体失败的操作');
    throw error;
  }
}

main()
  .catch((e) => {
    console.error('❌ 数据库初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

