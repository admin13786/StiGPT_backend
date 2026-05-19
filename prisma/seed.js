"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var bcrypt = __importStar(require("bcrypt"));
// 密码哈希函数
function hashPassword(password) {
    // 使用 bcrypt 加密密码
    return bcrypt.hashSync(password, 10);
}
var prisma = new client_1.PrismaClient();
// 重试函数
function retry(fn_1) {
    return __awaiter(this, arguments, void 0, function (fn, maxRetries, delay) {
        var lastError, i, error_1;
        if (maxRetries === void 0) { maxRetries = 3; }
        if (delay === void 0) { delay = 1000; }
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    i = 0;
                    _a.label = 1;
                case 1:
                    if (!(i < maxRetries)) return [3 /*break*/, 8];
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 7]);
                    return [4 /*yield*/, fn()];
                case 3: return [2 /*return*/, _a.sent()];
                case 4:
                    error_1 = _a.sent();
                    lastError = error_1;
                    if (!(i < maxRetries - 1)) return [3 /*break*/, 6];
                    console.warn("\u26A0\uFE0F  \u64CD\u4F5C\u5931\u8D25\uFF0C".concat(delay, "ms \u540E\u91CD\u8BD5 (").concat(i + 1, "/").concat(maxRetries, ")..."));
                    return [4 /*yield*/, new Promise(function (resolve) { return setTimeout(resolve, delay); })];
                case 5:
                    _a.sent();
                    _a.label = 6;
                case 6: return [3 /*break*/, 7];
                case 7:
                    i++;
                    return [3 /*break*/, 1];
                case 8: throw lastError;
            }
        });
    });
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var existingAdmin, adminUsers, _loop_1, _i, adminUsers_1, userData, agentUsers, _loop_2, _a, agentUsers_1, userData, games, _loop_3, _b, games_1, gameData, rules, _loop_4, _c, rules_1, ruleData, error_2;
        var _this = this;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    console.log('🌱 开始初始化数据库...\n');
                    // 检查必要的环境变量
                    if (!process.env.DATABASE_URL) {
                        console.error('❌ 错误: DATABASE_URL 环境变量未设置');
                        process.exit(1);
                    }
                    _d.label = 1;
                case 1:
                    _d.trys.push([1, 19, , 20]);
                    // 如果设置了 SKIP_SEED 环境变量，直接跳过
                    if (process.env.SKIP_SEED === 'true') {
                        console.log('⏭️  跳过种子数据初始化 (SKIP_SEED=true)');
                        return [2 /*return*/];
                    }
                    return [4 /*yield*/, prisma.user.findFirst({
                            where: {
                                role: 'ADMIN',
                                username: 'admin',
                            },
                        })];
                case 2:
                    existingAdmin = _d.sent();
                    if (existingAdmin) {
                        console.log('✅ 数据库已初始化，跳过种子数据创建');
                        console.log('💡 提示: 如需重新初始化，请设置 SKIP_SEED=false 或删除管理员账户');
                        return [2 /*return*/];
                    }
                    console.log('📝 检测到新数据库，开始初始化种子数据...\n');
                    adminUsers = [
                        {
                            username: 'admin',
                            password: 'admin123',
                            role: 'ADMIN',
                            realName: '系统管理员',
                            email: 'admin@example.com',
                            phone: '13800000001',
                        },
                        {
                            username: 'admin2',
                            password: 'admin123',
                            role: 'ADMIN',
                            realName: '副管理员',
                            email: 'admin2@example.com',
                            phone: '13800000002',
                        },
                    ];
                    _loop_1 = function (userData) {
                        return __generator(this, function (_e) {
                            switch (_e.label) {
                                case 0: return [4 /*yield*/, retry(function () { return __awaiter(_this, void 0, void 0, function () {
                                        var hashedPassword, user;
                                        return __generator(this, function (_a) {
                                            switch (_a.label) {
                                                case 0:
                                                    hashedPassword = hashPassword(userData.password);
                                                    return [4 /*yield*/, prisma.user.upsert({
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
                                                        })];
                                                case 1:
                                                    user = _a.sent();
                                                    console.log("\u2713 \u7BA1\u7406\u5458\u8D26\u6237: ".concat(user.username, " (").concat(userData.realName, ")"));
                                                    return [2 /*return*/];
                                            }
                                        });
                                    }); })];
                                case 1:
                                    _e.sent();
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _i = 0, adminUsers_1 = adminUsers;
                    _d.label = 3;
                case 3:
                    if (!(_i < adminUsers_1.length)) return [3 /*break*/, 6];
                    userData = adminUsers_1[_i];
                    return [5 /*yield**/, _loop_1(userData)];
                case 4:
                    _d.sent();
                    _d.label = 5;
                case 5:
                    _i++;
                    return [3 /*break*/, 3];
                case 6:
                    agentUsers = [
                        {
                            username: 'agent1',
                            password: 'agent123',
                            role: 'AGENT',
                            realName: '客服001',
                            email: 'agent1@example.com',
                            phone: '13800001001',
                        },
                        {
                            username: 'agent2',
                            password: 'agent123',
                            role: 'AGENT',
                            realName: '客服002',
                            email: 'agent2@example.com',
                            phone: '13800001002',
                        },
                        {
                            username: 'agent3',
                            password: 'agent123',
                            role: 'AGENT',
                            realName: '客服003',
                            email: 'agent3@example.com',
                            phone: '13800001003',
                        },
                    ];
                    _loop_2 = function (userData) {
                        return __generator(this, function (_f) {
                            switch (_f.label) {
                                case 0: return [4 /*yield*/, retry(function () { return __awaiter(_this, void 0, void 0, function () {
                                        var hashedPassword, user;
                                        return __generator(this, function (_a) {
                                            switch (_a.label) {
                                                case 0:
                                                    hashedPassword = hashPassword(userData.password);
                                                    return [4 /*yield*/, prisma.user.upsert({
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
                                                        })];
                                                case 1:
                                                    user = _a.sent();
                                                    console.log("\u2713 \u5BA2\u670D\u8D26\u6237: ".concat(user.username, " (").concat(userData.realName, ")"));
                                                    return [2 /*return*/];
                                            }
                                        });
                                    }); })];
                                case 1:
                                    _f.sent();
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _a = 0, agentUsers_1 = agentUsers;
                    _d.label = 7;
                case 7:
                    if (!(_a < agentUsers_1.length)) return [3 /*break*/, 10];
                    userData = agentUsers_1[_a];
                    return [5 /*yield**/, _loop_2(userData)];
                case 8:
                    _d.sent();
                    _d.label = 9;
                case 9:
                    _a++;
                    return [3 /*break*/, 7];
                case 10:
                    games = [
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
                    _loop_3 = function (gameData) {
                        return __generator(this, function (_g) {
                            switch (_g.label) {
                                case 0: return [4 /*yield*/, retry(function () { return __awaiter(_this, void 0, void 0, function () {
                                        var existing, game;
                                        return __generator(this, function (_a) {
                                            switch (_a.label) {
                                                case 0: return [4 /*yield*/, prisma.game.findUnique({
                                                        where: { name: gameData.name },
                                                    })];
                                                case 1:
                                                    existing = _a.sent();
                                                    return [4 /*yield*/, prisma.game.upsert({
                                                            where: { name: gameData.name },
                                                            update: __assign(__assign({}, (gameData.difyApiKey && gameData.difyApiKey !== 'your-dify-api-key-here'
                                                                ? { difyApiKey: gameData.difyApiKey }
                                                                : {})), { difyBaseUrl: gameData.difyBaseUrl }),
                                                            create: {
                                                                name: gameData.name,
                                                                icon: null,
                                                                enabled: true,
                                                                difyApiKey: gameData.difyApiKey,
                                                                difyBaseUrl: gameData.difyBaseUrl,
                                                            },
                                                        })];
                                                case 2:
                                                    game = _a.sent();
                                                    console.log("\u2713 \u6E38\u620F\u914D\u7F6E: ".concat(game.name));
                                                    return [2 /*return*/];
                                            }
                                        });
                                    }); })];
                                case 1:
                                    _g.sent();
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _b = 0, games_1 = games;
                    _d.label = 11;
                case 11:
                    if (!(_b < games_1.length)) return [3 /*break*/, 14];
                    gameData = games_1[_b];
                    return [5 /*yield**/, _loop_3(gameData)];
                case 12:
                    _d.sent();
                    _d.label = 13;
                case 13:
                    _b++;
                    return [3 /*break*/, 11];
                case 14:
                    rules = [
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
                    _loop_4 = function (ruleData) {
                        return __generator(this, function (_h) {
                            switch (_h.label) {
                                case 0: return [4 /*yield*/, retry(function () { return __awaiter(_this, void 0, void 0, function () {
                                        var existing, rule;
                                        return __generator(this, function (_a) {
                                            switch (_a.label) {
                                                case 0: return [4 /*yield*/, prisma.urgencyRule.findFirst({
                                                        where: { name: ruleData.name },
                                                    })];
                                                case 1:
                                                    existing = _a.sent();
                                                    if (!!existing) return [3 /*break*/, 3];
                                                    return [4 /*yield*/, prisma.urgencyRule.create({
                                                            data: ruleData,
                                                        })];
                                                case 2:
                                                    rule = _a.sent();
                                                    console.log("\u2713 \u7D27\u6025\u6392\u5E8F\u89C4\u5219: ".concat(rule.name));
                                                    return [3 /*break*/, 4];
                                                case 3:
                                                    console.log("\u2713 \u7D27\u6025\u6392\u5E8F\u89C4\u5219\u5DF2\u5B58\u5728: ".concat(ruleData.name));
                                                    _a.label = 4;
                                                case 4: return [2 /*return*/];
                                            }
                                        });
                                    }); })];
                                case 1:
                                    _h.sent();
                                    return [2 /*return*/];
                            }
                        });
                    };
                    _c = 0, rules_1 = rules;
                    _d.label = 15;
                case 15:
                    if (!(_c < rules_1.length)) return [3 /*break*/, 18];
                    ruleData = rules_1[_c];
                    return [5 /*yield**/, _loop_4(ruleData)];
                case 16:
                    _d.sent();
                    _d.label = 17;
                case 17:
                    _c++;
                    return [3 /*break*/, 15];
                case 18:
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
                    console.log("  \u6E38\u620F\u914D\u7F6E: ".concat(games.length, " \u4E2A"));
                    console.log("  \u7D27\u6025\u6392\u5E8F\u89C4\u5219: ".concat(rules.length, " \u4E2A"));
                    console.log('\n⚠️  重要提示:');
                    console.log('  1. 所有账户的默认密码都是 "admin123" 或 "agent123"');
                    console.log('  2. 请在生产环境中立即修改所有账户的密码！');
                    console.log('  3. 建议为每个账户设置强密码（至少8位，包含字母和数字）');
                    console.log('  4. 可以通过管理端修改账户密码');
                    console.log('  5. 游戏配置中的 Dify API Key 需要手动配置');
                    return [3 /*break*/, 20];
                case 19:
                    error_2 = _d.sent();
                    console.error('\n❌ 数据库初始化失败！');
                    console.error('错误详情:', error_2);
                    console.error('\n💡 排查建议:');
                    console.error('  1. 检查数据库连接是否正常');
                    console.error('  2. 检查数据库用户权限是否足够');
                    console.error('  3. 检查 Prisma schema 是否与数据库结构一致');
                    console.error('  4. 查看上方错误信息，定位具体失败的操作');
                    throw error_2;
                case 20: return [2 /*return*/];
            }
        });
    });
}
main()
    .catch(function (e) {
    console.error('❌ 数据库初始化失败:', e);
    process.exit(1);
})
    .finally(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
