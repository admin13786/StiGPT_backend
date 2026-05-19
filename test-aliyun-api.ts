import axios from 'axios';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

const ALIYUN_API_KEY = process.env.ALIYUN_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'qwen-turbo';

async function testAliyunAPI() {
  console.log('='.repeat(60));
  console.log('测试阿里云 DashScope API 配置');
  console.log('='.repeat(60));
  console.log();

  // 检查 API Key
  if (!ALIYUN_API_KEY) {
    console.error('❌ 错误：未找到 ALIYUN_API_KEY 环境变量');
    process.exit(1);
  }

  console.log('✅ API Key 已配置:', ALIYUN_API_KEY.substring(0, 10) + '...');
  console.log('✅ 使用模型:', LLM_MODEL);
  console.log();

  // 测试 API 调用
  console.log('正在测试 API 调用...');
  console.log();

  try {
    const response = await axios.post(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
      {
        model: LLM_MODEL,
        input: {
          messages: [
            {
              role: 'system',
              content: '你是一个科研助手。',
            },
            {
              role: 'user',
              content: '请简单介绍一下人工智能。',
            },
          ],
        },
        parameters: {
          temperature: 0.7,
          max_tokens: 100,
          top_p: 0.8,
          result_format: 'message',
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${ALIYUN_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      },
    );

    if (response.data.output && response.data.output.choices && response.data.output.choices.length > 0) {
      const choice = response.data.output.choices[0];
      const usage = response.data.usage || {};

      console.log('✅ API 调用成功！');
      console.log();
      console.log('响应内容:');
      console.log('-'.repeat(60));
      console.log(choice.message.content);
      console.log('-'.repeat(60));
      console.log();
      console.log('Token 使用情况:');
      console.log(`  - 输入 Token: ${usage.input_tokens || 0}`);
      console.log(`  - 输出 Token: ${usage.output_tokens || 0}`);
      console.log(`  - 总计 Token: ${usage.total_tokens || 0}`);
      console.log();
      console.log('='.repeat(60));
      console.log('✅ 阿里云 API 配置正确，可以正常使用！');
      console.log('='.repeat(60));
    } else {
      console.error('❌ API 返回格式异常');
      console.error('响应数据:', JSON.stringify(response.data, null, 2));
      process.exit(1);
    }
  } catch (error: any) {
    console.error('❌ API 调用失败');
    console.error();
    
    if (axios.isAxiosError(error)) {
      if (error.response) {
        console.error('错误状态码:', error.response.status);
        console.error('错误信息:', JSON.stringify(error.response.data, null, 2));
        
        if (error.response.status === 401) {
          console.error();
          console.error('提示：API Key 可能无效或已过期，请检查 ALIYUN_API_KEY 配置');
        } else if (error.response.status === 429) {
          console.error();
          console.error('提示：API 调用频率超限，请稍后重试');
        }
      } else if (error.request) {
        console.error('网络错误：无法连接到阿里云服务器');
        console.error('请检查网络连接');
      } else {
        console.error('请求配置错误:', error.message);
      }
    } else {
      console.error('未知错误:', error);
    }
    
    console.error();
    console.error('='.repeat(60));
    console.error('❌ 阿里云 API 配置测试失败');
    console.error('='.repeat(60));
    process.exit(1);
  }
}

testAliyunAPI();
